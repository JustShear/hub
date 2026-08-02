import { db } from "~/lib/db.server";
import { shopifyGraphQLRequest, ShopifyGraphQLError } from "~/adapters/shopify/client.server";
import {
  recordIntegrationFailure,
  recordIntegrationSuccessAfterFailure,
} from "~/domain/integrations/record-failure.server";

const ADD_ONLY_MUTATION = `
  mutation SyncOrderLifecycleTagAdd($id: ID!, $tagsToAdd: [String!]!) {
    add: tagsAdd(id: $id, tags: $tagsToAdd) {
      node { id }
      userErrors { field message }
    }
  }
`;

const ADD_AND_REMOVE_MUTATION = `
  mutation SyncOrderLifecycleTag($id: ID!, $tagsToAdd: [String!]!, $tagsToRemove: [String!]!) {
    add: tagsAdd(id: $id, tags: $tagsToAdd) {
      node { id }
      userErrors { field message }
    }
    remove: tagsRemove(id: $id, tags: $tagsToRemove) {
      node { id }
      userErrors { field message }
    }
  }
`;

interface TagMutationField {
  node: { id: string } | null;
  userErrors: { field: string[] | null; message: string }[];
}

interface SyncOrderLifecycleTagResponse {
  add: TagMutationField;
  remove?: TagMutationField;
}

export interface SyncOrderLifecycleTagInput {
  shopId: string;
  orderId: string;
  addTag: string;
  /** May be empty — the tagsRemove leg is skipped entirely when empty. */
  removeTags: string[];
}

export type SyncOrderLifecycleTagResult =
  | { outcome: "synced" }
  // One leg (add/remove) succeeded, one failed — tags reflects reality, not the target state.
  | { outcome: "partial"; reason: string }
  | { outcome: "rejected"; reason: string };

/**
 * Writes a lifecycle tag to the real Shopify order — mirrors
 * sync-tracking-to-shopify.server.ts's shape exactly (the app's only other
 * Shopify write): never throws under normal operation, records failures via
 * the existing IntegrationFailure/IntegrationType.SHOPIFY_TAG_UPDATE
 * mechanism (a reserved-but-unused enum value until now), and only updates
 * the local `tags` array after a confirmed Shopify response. The next
 * scheduled re-sync will read back the same tag content this function just
 * wrote, so there's no conflict with the "tags is Shopify-owned" convention
 * — only a brief window of local-Hub-authoritative staleness, which is safe
 * because the board's column placement only ever reads the local copy.
 *
 * Not atomic: Shopify accepts/rejects tagsAdd and tagsRemove independently
 * in the same response, so each leg's userErrors is checked separately and
 * the local `tags` array is updated to reflect exactly what actually landed
 * in Shopify, never the idealised target state.
 */
export async function syncOrderLifecycleTag(
  input: SyncOrderLifecycleTagInput,
): Promise<SyncOrderLifecycleTagResult> {
  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    include: { shop: true },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }

  const clientOptions = {
    shopDomain: order.shop.shopifyDomain,
    accessToken: order.shop.adminApiToken,
  };

  try {
    const data = await shopifyGraphQLRequest<SyncOrderLifecycleTagResponse>(
      clientOptions,
      input.removeTags.length > 0 ? ADD_AND_REMOVE_MUTATION : ADD_ONLY_MUTATION,
      {
        id: order.shopifyOrderGid,
        tagsToAdd: [input.addTag],
        ...(input.removeTags.length > 0 ? { tagsToRemove: input.removeTags } : {}),
      },
    );

    const addErrors = data.add.userErrors;
    const removeErrors = data.remove?.userErrors ?? [];

    const nextTags = new Set(order.tags);
    if (addErrors.length === 0) {
      nextTags.add(input.addTag);
    }
    if (removeErrors.length === 0) {
      for (const tag of input.removeTags) {
        nextTags.delete(tag);
      }
    }
    await db.shopifyOrder.update({
      where: { id: order.id },
      data: { tags: [...nextTags] },
    });

    if (addErrors.length === 0 && removeErrors.length === 0) {
      await recordIntegrationSuccessAfterFailure(
        input.shopId,
        "SHOPIFY_TAG_UPDATE",
        "order_tag_sync",
        order.id,
      );
      return { outcome: "synced" };
    }

    const summary = [...addErrors, ...removeErrors].map((e) => e.message).join("; ");
    await recordIntegrationFailure({
      shopId: input.shopId,
      integration: "SHOPIFY_TAG_UPDATE",
      action: "order_tag_sync",
      relatedOrderId: order.id,
      summary: `Shopify rejected part of the tag sync: ${summary}`,
      severity: "LOW",
      retryable: true,
    });
    return { outcome: "partial", reason: summary };
  } catch (error) {
    const isShopifyError = error instanceof ShopifyGraphQLError;
    await recordIntegrationFailure({
      shopId: input.shopId,
      integration: "SHOPIFY_TAG_UPDATE",
      action: "order_tag_sync",
      relatedOrderId: order.id,
      summary: "Failed to sync a lifecycle tag to Shopify.",
      technicalDetail: isShopifyError ? error.message : String(error),
      severity: "LOW",
      retryable: true,
    });
    return { outcome: "rejected", reason: "Failed to sync a lifecycle tag to Shopify." };
  }
}
