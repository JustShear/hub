import { db } from "~/lib/db.server";
import { loadCustomerProofFile } from "~/domain/customers/customer-query.server";
import { DECORATION_METHOD_LABELS } from "~/domain/proofs/labels";
import { buildProofImageUrl } from "~/domain/customer-account/signed-image-url.server";

// What a customer sees on their own account page. This is a deliberately
// separate, explicit shape - NOT the staff-facing customer file - so nothing
// internal (order ids, asset ids, internal notes, change-request history,
// staff names) can reach a customer by accident. If a field is not listed
// here, it is not sent.
export interface CustomerAccountProof {
  id: string;
  orderNumber: string;
  artworkName: string;
  method: string;
  /** ISO timestamp the proof was approved. */
  approvedAt: string;
  /** Short-lived signed link to the image, or null if there is no previewable image. */
  imageUrl: string | null;
}

const MAX_PROOFS = 100;

export async function loadAcceptedProofsForCustomerAccount(input: {
  shopId: string;
  customerId: string;
  baseUrl: string;
  secret: string;
  nowMs?: number;
}): Promise<CustomerAccountProof[]> {
  const file = await loadCustomerProofFile({
    shopId: input.shopId,
    identity: { kind: "shopify", shopifyCustomerId: input.customerId },
  });
  if (!file) {
    return [];
  }

  return file.accepted.slice(0, MAX_PROOFS).map((card) => ({
    id: card.versionId,
    orderNumber: card.orderNumber,
    artworkName: card.groupName,
    method: DECORATION_METHOD_LABELS[card.decorationMethod],
    approvedAt: card.at,
    imageUrl:
      card.assetId && (card.mimeType ?? "").startsWith("image/")
        ? buildProofImageUrl({
            baseUrl: input.baseUrl,
            secret: input.secret,
            assetId: card.assetId,
            customerId: input.customerId,
            nowMs: input.nowMs,
          })
        : null,
  }));
}

/**
 * Serve-time ownership check for the image route: the asset must belong to an
 * APPROVED version on an order that belongs to this Shopify customer, in this
 * shop. Returns the asset's storage details, or null (which the route answers
 * with a plain 404 - the same answer as for a file that doesn't exist).
 */
export async function findAcceptedProofAssetForCustomer(input: {
  shopId: string;
  customerId: string;
  assetId: string;
}) {
  return db.proofAsset.findFirst({
    where: {
      id: input.assetId,
      proofVersion: {
        status: "APPROVED",
        proofGroup: {
          status: { not: "CANCELLED" },
          order: {
            shopId: input.shopId,
            customerShopifyGid: `gid://shopify/Customer/${input.customerId}`,
          },
        },
      },
    },
    select: { storageKey: true, mimeType: true },
  });
}
