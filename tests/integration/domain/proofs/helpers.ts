import { randomUUID } from "node:crypto";
import { db } from "~/lib/db.server";

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
      await db.integrationFailure.deleteMany({ where: { relatedOrderId: { in: orderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (staffUserIds.length > 0) {
      await db.staffUser.deleteMany({ where: { id: { in: staffUserIds } } });
    }
  }

  async function createOrder() {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#proof-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
      },
    });
    orderIds.push(order.id);
    return order;
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

  return { cleanup, createOrder, createOrderLine, createStaffUser, createAsset };
}

export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
export const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", "utf8");
