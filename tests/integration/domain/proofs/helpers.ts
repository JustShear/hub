import { randomUUID } from "node:crypto";
import { db } from "~/lib/db.server";
import { createProofGroup } from "~/domain/proofs/create-proof-group.server";
import { createProofVersion } from "~/domain/proofs/create-proof-version.server";
import { markProofVersionReady } from "~/domain/proofs/mark-proof-version-ready.server";

/** Shared fixture helpers for proof-domain integration tests — mirrors the pattern established in tests/integration/domain/orders/*. */
export function createProofTestTracker() {
  const orderIds: string[] = [];
  const staffUserIds: string[] = [];

  async function cleanup() {
    if (orderIds.length > 0) {
      const lineIds = (
        await db.shopifyOrderLine.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((l) => l.id);

      // Milestone 09 rows — proof requests bundle groups/versions from
      // these orders, so they must be cleared before the groups/versions
      // themselves (and before the order row itself, since ProofRequest
      // has a direct FK to ShopifyOrder).
      const requestIds = (
        await db.proofRequest.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((r) => r.id);
      if (requestIds.length > 0) {
        const responseIds = (
          await db.customerProofResponse.findMany({
            where: { proofRequestId: { in: requestIds } },
            select: { id: true },
          })
        ).map((r) => r.id);
        if (responseIds.length > 0) {
          await db.customerResponseAsset.deleteMany({ where: { responseId: { in: responseIds } } });
          await db.customerProofResponse.deleteMany({ where: { id: { in: responseIds } } });
        }
        await db.proofReminder.deleteMany({ where: { proofRequestId: { in: requestIds } } });
        await db.klaviyoDispatch.deleteMany({ where: { proofRequestId: { in: requestIds } } });
        await db.proofRequestGroup.deleteMany({ where: { proofRequestId: { in: requestIds } } });
        await db.proofRequest.deleteMany({ where: { id: { in: requestIds } } });
      }

      const groupIds = (
        await db.proofGroup.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } })
      ).map((g) => g.id);
      if (groupIds.length > 0) {
        const versionIds = (
          await db.proofVersion.findMany({
            where: { proofGroupId: { in: groupIds } },
            select: { id: true },
          })
        ).map((v) => v.id);
        if (versionIds.length > 0) {
          await db.proofVersionSourceAsset.deleteMany({
            where: { proofVersionId: { in: versionIds } },
          });
          await db.proofAsset.deleteMany({ where: { proofVersionId: { in: versionIds } } });
          await db.proofNote.deleteMany({ where: { proofVersionId: { in: versionIds } } });
          await db.proofVersion.updateMany({
            where: { id: { in: versionIds } },
            data: { supersededByVersionId: null },
          });
          await db.proofVersion.deleteMany({ where: { id: { in: versionIds } } });
        }
        await db.proofGroupArtworkAsset.deleteMany({ where: { proofGroupId: { in: groupIds } } });
        await db.proofGroupOrderLine.deleteMany({ where: { proofGroupId: { in: groupIds } } });
        await db.proofNote.deleteMany({ where: { proofGroupId: { in: groupIds } } });
        await db.proofRequirement.deleteMany({ where: { proofGroupId: { in: groupIds } } });
        await db.integrationFailure.deleteMany({
          where: { relatedProofGroupId: { in: groupIds } },
        });
        await db.manualOverride.deleteMany({ where: { relatedEntityId: { in: groupIds } } });
        await db.proofGroup.deleteMany({ where: { id: { in: groupIds } } });
      }

      if (lineIds.length > 0) {
        await db.artworkOrderLineLink.deleteMany({ where: { orderLineId: { in: lineIds } } });
        await db.shopifyLineProperty.deleteMany({ where: { orderLineId: { in: lineIds } } });
        await db.shopifyOrderLine.deleteMany({ where: { id: { in: lineIds } } });
      }

      await db.activityEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      // A real Klaviyo dispatch attempt fails in the test environment (no
      // real API key) and genuinely records an IntegrationFailure —
      // IntegrationAttempt children must go first.
      const orderFailureIds = (
        await db.integrationFailure.findMany({
          where: { relatedOrderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((f) => f.id);
      if (orderFailureIds.length > 0) {
        await db.integrationAttempt.deleteMany({ where: { failureId: { in: orderFailureIds } } });
      }
      await db.integrationFailure.deleteMany({ where: { relatedOrderId: { in: orderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (staffUserIds.length > 0) {
      await db.staffUser.deleteMany({ where: { id: { in: staffUserIds } } });
    }
  }

  async function createOrder(
    overrides: {
      customerEmail?: string | null;
      customerName?: string | null;
      cancelledAt?: Date;
    } = {},
  ) {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#proof-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        customerEmail:
          "customerEmail" in overrides
            ? overrides.customerEmail
            : `customer-${randomUUID()}@example.test`,
        customerName: "customerName" in overrides ? overrides.customerName : "Test Customer",
        cancelledAt: overrides.cancelledAt,
      },
    });
    orderIds.push(order.id);
    return order;
  }

  /** Creates a proof group with a version already marked READY_TO_SEND — the precondition every M9 send/response test starts from. */
  async function createReadyGroup(params: {
    orderId: string;
    shopId: string;
    staffUserId: string;
    orderLineIds?: string[];
    name?: string;
  }) {
    // Readiness requires at least one linked order line — auto-create one
    // if the caller didn't supply any, so callers that don't care about
    // line linkage specifically don't need to plumb one through.
    const orderLineIds = params.orderLineIds ?? [(await createOrderLine(params.orderId)).id];
    const group = await createProofGroup({
      shopId: params.shopId,
      orderId: params.orderId,
      name: params.name ?? "Test proof group",
      decorationMethod: "EMBROIDERY",
      placement: "Left chest",
      description: null,
      requirement: "REQUIRED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds,
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: params.staffUserId,
    });
    if (group.outcome !== "created") {
      throw new Error(`createReadyGroup: failed to create group — ${JSON.stringify(group)}`);
    }
    const version = await createProofVersion({
      shopId: params.shopId,
      proofGroupId: group.proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "proof.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: params.staffUserId,
    });
    if (version.outcome !== "created") {
      throw new Error(`createReadyGroup: failed to create version — ${JSON.stringify(version)}`);
    }
    const ready = await markProofVersionReady({
      shopId: params.shopId,
      proofVersionId: version.proofVersionId,
      staffUserId: params.staffUserId,
    });
    if (ready.outcome !== "ready") {
      throw new Error(`createReadyGroup: failed to mark ready — ${JSON.stringify(ready)}`);
    }
    return { proofGroupId: group.proofGroupId, proofVersionId: version.proofVersionId };
  }

  async function createOrderLine(orderId: string, quantity = 1) {
    return db.shopifyOrderLine.create({
      data: {
        orderId,
        shopifyLineGid: `gid://shopify/LineItem/${randomUUID()}`,
        productTitle: "Test Product",
        quantity,
      },
    });
  }

  async function createStaffUser(isActive = true) {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: `test-${randomUUID()}@example.com`,
        name: "Test Staff",
        passwordHash: "irrelevant",
        isActive,
      },
    });
    staffUserIds.push(staffUser.id);
    return staffUser;
  }

  async function createAsset(shopId: string) {
    return db.customerArtworkAsset.create({
      data: {
        shopId,
        originalFilename: "test-asset.png",
        sourceUrl: `https://example.test/${randomUUID()}.png`,
      },
    });
  }

  return { cleanup, createOrder, createOrderLine, createStaffUser, createAsset, createReadyGroup };
}

export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
export const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", "utf8");
