import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import {
  countUnreadNotifications,
  loadRecentNotifications,
} from "~/domain/notifications/notification-query.server";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "~/domain/notifications/mark-notification-read.server";
import { createExceptionCase } from "~/domain/exceptions/create-exception-case.server";
import { assignExceptionCase } from "~/domain/exceptions/assign-exception-case.server";
import { createExceptionTestTracker } from "../exceptions/helpers";
import { assignWarehousePickJob } from "~/domain/warehouse/assign-warehouse-pick-job.server";
import { createWarehouseIssue } from "~/domain/warehouse/warehouse-issue.server";
import { createWarehouseTestTracker } from "../warehouse/helpers";

describe("notification query + mark-read (integration)", () => {
  const tracker = createExceptionTestTracker();
  afterAll(tracker.cleanup);

  it("counts unread, lists most-recent-first, and marks read individually and all at once", async () => {
    const staffUser = await tracker.createStaffUser();

    const first = await db.notification.create({
      data: { staffUserId: staffUser.id, type: "test", title: "First" },
    });
    const second = await db.notification.create({
      data: { staffUserId: staffUser.id, type: "test", title: "Second" },
    });

    expect(await countUnreadNotifications(staffUser.id)).toBe(2);
    const recent = await loadRecentNotifications(staffUser.id);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.id).toBe(second.id);
    expect(recent[1]?.id).toBe(first.id);

    const marked = await markNotificationRead({
      staffUserId: staffUser.id,
      notificationId: first.id,
    });
    expect(marked.outcome).toBe("marked");
    expect(await countUnreadNotifications(staffUser.id)).toBe(1);

    await markAllNotificationsRead(staffUser.id);
    expect(await countUnreadNotifications(staffUser.id)).toBe(0);
  });

  it("rejects marking a notification that doesn't belong to the caller", async () => {
    const owner = await tracker.createStaffUser();
    const otherStaff = await tracker.createStaffUser();
    const notification = await db.notification.create({
      data: { staffUserId: owner.id, type: "test", title: "Not yours" },
    });

    const result = await markNotificationRead({
      staffUserId: otherStaff.id,
      notificationId: notification.id,
    });
    expect(result.outcome).toBe("rejected");
  });
});

describe("exception case assignment creates a notification (integration)", () => {
  const tracker = createExceptionTestTracker();
  afterAll(tracker.cleanup);

  it("notifies the newly assigned staff member, linked to the case", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const assignee = await tracker.createStaffUser();
    const created = await createExceptionCase({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: null,
      category: "OTHER",
      initiatedBy: "STAFF",
      summary: "Notification test case",
      customerNote: null,
      staffUserId: staffUser.id,
    });
    if (created.outcome !== "created") throw new Error("setup failed");
    tracker.trackExceptionCase(created.exceptionCaseId);

    await assignExceptionCase({
      shopId: order.shopId,
      exceptionCaseId: created.exceptionCaseId,
      targetStaffUserId: assignee.id,
      expectedStaffUserId: null,
      staffUserId: staffUser.id,
    });

    const notification = await db.notification.findFirst({
      where: { staffUserId: assignee.id, relatedEntityType: "ExceptionCase" },
    });
    expect(notification).not.toBeNull();
    expect(notification?.relatedEntityId).toBe(created.exceptionCaseId);
  });

  it("never notifies when a staff member assigns the case to themselves", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const created = await createExceptionCase({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: null,
      category: "OTHER",
      initiatedBy: "STAFF",
      summary: "Self-assign test case",
      customerNote: null,
      staffUserId: staffUser.id,
    });
    if (created.outcome !== "created") throw new Error("setup failed");
    tracker.trackExceptionCase(created.exceptionCaseId);

    await assignExceptionCase({
      shopId: order.shopId,
      exceptionCaseId: created.exceptionCaseId,
      targetStaffUserId: staffUser.id,
      expectedStaffUserId: null,
      staffUserId: staffUser.id,
    });

    expect(await db.notification.count({ where: { staffUserId: staffUser.id } })).toBe(0);
  });
});

describe("a blocking warehouse issue notifies the assigned staff member (integration)", () => {
  const tracker = createWarehouseTestTracker();
  afterAll(tracker.cleanup);

  it("notifies only on a blocking issue, never on a non-blocking one", async () => {
    const order = await tracker.createOrder();
    const reporter = await tracker.createStaffUser();
    const assignee = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id, 3);
    const job = await tracker.createPickJobForOrder({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: line.id,
      quantity: 3,
      staffUserId: reporter.id,
    });

    await assignWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: job.id,
      targetStaffUserId: assignee.id,
      expectedVersion: job.version,
      staffUserId: reporter.id,
    });

    await createWarehouseIssue({
      shopId: order.shopId,
      warehousePickJobId: job.id,
      warehousePickItemId: null,
      issueType: "STOCK_SHORTAGE",
      severity: "HIGH",
      description: "Non-blocking note.",
      isBlocking: false,
      staffUserId: reporter.id,
    });
    expect(await db.notification.count({ where: { staffUserId: assignee.id } })).toBe(0);

    await createWarehouseIssue({
      shopId: order.shopId,
      warehousePickJobId: job.id,
      warehousePickItemId: null,
      issueType: "STOCK_SHORTAGE",
      severity: "HIGH",
      description: "Blocking issue.",
      isBlocking: true,
      staffUserId: reporter.id,
    });

    const notification = await db.notification.findFirst({
      where: { staffUserId: assignee.id, relatedEntityType: "WarehousePickJob" },
    });
    expect(notification).not.toBeNull();
    expect(notification?.relatedEntityId).toBe(job.id);
  });
});
