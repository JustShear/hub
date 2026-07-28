import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  ActorType,
  AssignmentRole,
  DueDateSource,
  DueDateType,
  IntegrationFailureStatus,
  IntegrationType,
  NoteVisibility,
  PropertyDetectedType,
  Severity,
} from "@prisma/client";
import { db } from "~/lib/db.server";
import {
  getAssignableStaff,
  loadMoreActivity,
  loadMoreNotes,
  loadOrderDetail,
  NOTES_PAGE_SIZE,
} from "~/domain/orders/order-detail-query.server";

describe("order-detail-query (integration)", () => {
  const createdOrderIds: string[] = [];
  const createdStaffUserIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      const lineIds = (
        await db.shopifyOrderLine.findMany({
          where: { orderId: { in: createdOrderIds } },
          select: { id: true },
        })
      ).map((l) => l.id);
      if (lineIds.length > 0) {
        const assetIds = (
          await db.artworkOrderLineLink.findMany({
            where: { orderLineId: { in: lineIds } },
            select: { assetId: true },
          })
        ).map((l) => l.assetId);
        await db.artworkOrderLineLink.deleteMany({ where: { orderLineId: { in: lineIds } } });
        if (assetIds.length > 0) {
          await db.customerArtworkAsset.deleteMany({ where: { id: { in: assetIds } } });
        }
        await db.shopifyLineProperty.deleteMany({ where: { orderLineId: { in: lineIds } } });
        await db.shopifyOrderLine.deleteMany({ where: { id: { in: lineIds } } });
      }
      await db.activityEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.orderNote.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      const failureIds = (
        await db.integrationFailure.findMany({
          where: { relatedOrderId: { in: createdOrderIds } },
          select: { id: true },
        })
      ).map((f) => f.id);
      if (failureIds.length > 0) {
        await db.integrationAttempt.deleteMany({ where: { failureId: { in: failureIds } } });
      }
      await db.integrationFailure.deleteMany({
        where: { relatedOrderId: { in: createdOrderIds } },
      });
      await db.orderAssignment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.orderDueDate.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdStaffUserIds.length > 0) {
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    }
  });

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
    createdStaffUserIds.push(staffUser.id);
    return staffUser;
  }

  it("returns null for an order that doesn't exist", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const result = await loadOrderDetail({
      shopId: shop.id,
      orderId: "does-not-exist",
      includeIntegrationTechnicalDetail: false,
    });
    expect(result).toBeNull();
  });

  it("loads lines in order with their properties and artwork links, and picks the ARTWORK-role assignment as primary", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const staff = await createStaffUser();
    const otherRoleStaff = await createStaffUser();

    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#detail-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: ["embroidery"],
        rawPayload: {},
      },
    });
    createdOrderIds.push(order.id);

    const lineA = await db.shopifyOrderLine.create({
      data: {
        orderId: order.id,
        shopifyLineGid: `gid://shopify/LineItem/${randomUUID()}`,
        productTitle: "First Product",
        quantity: 1,
      },
    });
    const lineB = await db.shopifyOrderLine.create({
      data: {
        orderId: order.id,
        shopifyLineGid: `gid://shopify/LineItem/${randomUUID()}`,
        productTitle: "Second Product",
        quantity: 2,
      },
    });
    await db.shopifyLineProperty.create({
      data: {
        orderLineId: lineA.id,
        name: "Embroidery text",
        value: "Test Co.",
        sortOrder: 0,
        detectedType: PropertyDetectedType.TEXT,
      },
    });

    const asset = await db.customerArtworkAsset.create({
      data: {
        shopId: shop.id,
        originalFilename: "logo.png",
        sourceUrl: `https://example.test/${randomUUID()}.png`,
      },
    });
    await db.artworkOrderLineLink.create({ data: { assetId: asset.id, orderLineId: lineB.id } });

    // Assignment on a non-ARTWORK role should not be picked as primary.
    await db.orderAssignment.create({
      data: { orderId: order.id, staffUserId: otherRoleStaff.id, role: AssignmentRole.PACKING },
    });
    await db.orderAssignment.create({
      data: { orderId: order.id, staffUserId: staff.id, role: AssignmentRole.ARTWORK },
    });

    const detail = await loadOrderDetail({
      shopId: shop.id,
      orderId: order.id,
      includeIntegrationTechnicalDetail: false,
    });

    expect(detail).not.toBeNull();
    expect(detail?.lines.map((l) => l.productTitle)).toEqual(["First Product", "Second Product"]);
    expect(detail?.lines[0]?.properties).toHaveLength(1);
    expect(detail?.lines[1]?.artworkLinks).toHaveLength(1);
    expect(detail?.assignment?.staffUserId).toBe(staff.id);
    expect(detail?.assignment?.role).toBe(AssignmentRole.ARTWORK);
  });

  it("gates integration failure technical detail and attempts behind includeIntegrationTechnicalDetail", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#detail-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
      },
    });
    createdOrderIds.push(order.id);

    const failure = await db.integrationFailure.create({
      data: {
        shopId: shop.id,
        integration: IntegrationType.SHOPIFY_TAG_UPDATE,
        action: "update_order_tags",
        relatedOrderId: order.id,
        summary: "Failed to sync tags",
        technicalDetail: "Sensitive stack trace content",
        severity: Severity.MEDIUM,
        status: IntegrationFailureStatus.NEW,
      },
    });
    await db.integrationAttempt.create({
      data: { failureId: failure.id, succeeded: false, errorSummary: "timeout" },
    });

    const withoutTechnical = await loadOrderDetail({
      shopId: shop.id,
      orderId: order.id,
      includeIntegrationTechnicalDetail: false,
    });
    expect(withoutTechnical?.integrationIssues[0]?.summary).toBe("Failed to sync tags");
    expect(withoutTechnical?.integrationIssues[0]?.technicalDetail).toBeUndefined();
    expect(withoutTechnical?.integrationIssues[0]?.attempts).toBeUndefined();

    const withTechnical = await loadOrderDetail({
      shopId: shop.id,
      orderId: order.id,
      includeIntegrationTechnicalDetail: true,
    });
    expect(withTechnical?.integrationIssues[0]?.technicalDetail).toBe(
      "Sensitive stack trace content",
    );
    expect(withTechnical?.integrationIssues[0]?.attempts).toHaveLength(1);
  });

  it("paginates notes with a correct hasMore flag and supports loadMoreNotes", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const staff = await createStaffUser();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#detail-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
      },
    });
    createdOrderIds.push(order.id);

    const totalNotes = NOTES_PAGE_SIZE + 5;
    for (let i = 0; i < totalNotes; i++) {
      await db.orderNote.create({
        data: {
          orderId: order.id,
          authorStaffId: staff.id,
          body: `Note number ${i}`,
          visibility: NoteVisibility.INTERNAL,
          createdAt: new Date(Date.now() - (totalNotes - i) * 1000),
        },
      });
    }

    const detail = await loadOrderDetail({
      shopId: shop.id,
      orderId: order.id,
      includeIntegrationTechnicalDetail: false,
    });
    if (!detail) throw new Error("expected order detail to load");
    expect(detail.notes).toHaveLength(NOTES_PAGE_SIZE);
    expect(detail.notesHasMore).toBe(true);
    expect(detail.notesTotalCount).toBe(totalNotes);

    const lastNote = detail.notes[detail.notes.length - 1];
    if (!lastNote) throw new Error("expected at least one note");
    const more = await loadMoreNotes({ shopId: shop.id, orderId: order.id, cursorId: lastNote.id });
    expect(more.notes.length).toBe(5);
    expect(more.hasMore).toBe(false);
  });

  it("paginates activity with a correct hasMore flag and supports loadMoreActivity", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#detail-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
      },
    });
    createdOrderIds.push(order.id);

    const totalEvents = 35;
    for (let i = 0; i < totalEvents; i++) {
      await db.activityEvent.create({
        data: {
          shopId: shop.id,
          orderId: order.id,
          entityType: "ShopifyOrder",
          entityId: order.id,
          eventType: "workflow_status_changed",
          summary: `Event ${i}`,
          actorType: ActorType.SYSTEM,
          createdAt: new Date(Date.now() - (totalEvents - i) * 1000),
        },
      });
    }

    const detail = await loadOrderDetail({
      shopId: shop.id,
      orderId: order.id,
      includeIntegrationTechnicalDetail: false,
    });
    if (!detail) throw new Error("expected order detail to load");
    expect(detail.activity).toHaveLength(30);
    expect(detail.activityHasMore).toBe(true);

    const lastEvent = detail.activity[detail.activity.length - 1];
    if (!lastEvent) throw new Error("expected at least one activity event");
    const more = await loadMoreActivity({
      shopId: shop.id,
      orderId: order.id,
      cursorId: lastEvent.id,
    });
    expect(more.events.length).toBe(5);
    expect(more.hasMore).toBe(false);
  });

  it("classifies overdue and future due dates", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#detail-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
      },
    });
    createdOrderIds.push(order.id);

    await db.orderDueDate.create({
      data: {
        orderId: order.id,
        type: DueDateType.DISPATCH,
        dueDate: new Date(Date.now() - 5 * 86_400_000),
        source: DueDateSource.MANUAL_OVERRIDE,
      },
    });

    const detail = await loadOrderDetail({
      shopId: shop.id,
      orderId: order.id,
      includeIntegrationTechnicalDetail: false,
    });
    expect(detail?.dueDates[0]?.state).toBe("overdue");
  });

  it("getAssignableStaff only returns active staff for the shop", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const active = await createStaffUser(true);
    const inactive = await createStaffUser(false);

    const staff = await getAssignableStaff(shop.id);
    const ids = staff.map((s) => s.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
  });
});
