import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { sendProofRequest } from "~/domain/proofs/send-proof-request.server";
import { suppressProofReminder } from "~/domain/proofs/suppress-proof-reminder.server";
import { dispatchDueProofReminders } from "~/domain/proofs/dispatch-due-proof-reminders.server";
import { createProofTestTracker } from "./helpers";

describe("proof reminders (integration)", () => {
  const tracker = createProofTestTracker();
  afterAll(tracker.cleanup);

  async function sendSingleGroup() {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const { proofGroupId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
    });
    const sendResult = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      staffMessage: null,
      staffUserId: staffUser.id,
    });
    if (sendResult.outcome !== "sent") throw new Error("setup failed");
    return { order, staffUser, proofGroupId, proofRequestId: sendResult.proofRequestId };
  }

  it("schedules exactly one reminder when a proof request is sent", async () => {
    const { proofRequestId } = await sendSingleGroup();

    const reminderCount = await db.proofReminder.count({ where: { proofRequestId } });
    expect(reminderCount).toBe(1);
  });

  it("allows suppressing the reminder before it's due, with a reason", async () => {
    const { order, staffUser, proofRequestId } = await sendSingleGroup();

    const result = await suppressProofReminder({
      shopId: order.shopId,
      proofRequestId,
      reason: "Customer confirmed by phone.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "suppressed" });
    const reminder = await db.proofReminder.findUniqueOrThrow({ where: { proofRequestId } });
    expect(reminder.suppressed).toBe(true);
    expect(reminder.suppressedReason).toBe("Customer confirmed by phone.");
  });

  it("requires a reason to suppress", async () => {
    const { order, staffUser, proofRequestId } = await sendSingleGroup();

    const result = await suppressProofReminder({
      shopId: order.shopId,
      proofRequestId,
      reason: "",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("suppressing an already-suppressed reminder is idempotent", async () => {
    const { order, staffUser, proofRequestId } = await sendSingleGroup();
    await suppressProofReminder({
      shopId: order.shopId,
      proofRequestId,
      reason: "First.",
      staffUserId: staffUser.id,
    });

    const second = await suppressProofReminder({
      shopId: order.shopId,
      proofRequestId,
      reason: "Second.",
      staffUserId: staffUser.id,
    });

    expect(second).toMatchObject({ outcome: "already_there" });
  });

  it("cannot suppress a reminder that has already been sent", async () => {
    const { order, staffUser, proofRequestId } = await sendSingleGroup();
    await db.proofReminder.updateMany({
      where: { proofRequestId },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });
    await dispatchDueProofReminders();
    const reminder = await db.proofReminder.findUniqueOrThrow({ where: { proofRequestId } });
    expect(reminder.sentAt).not.toBeNull();

    const result = await suppressProofReminder({
      shopId: order.shopId,
      proofRequestId,
      reason: "Too late.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("dispatches a due reminder exactly once, even if the poller runs twice", async () => {
    const { proofRequestId } = await sendSingleGroup();
    await db.proofReminder.updateMany({
      where: { proofRequestId },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });

    await dispatchDueProofReminders();
    await dispatchDueProofReminders();

    const reminder = await db.proofReminder.findUniqueOrThrow({ where: { proofRequestId } });
    expect(reminder.sentAt).not.toBeNull();
    const dispatchCount = await db.klaviyoDispatch.count({
      where: { proofRequestId, eventType: "PROOF_REMINDER" },
    });
    expect(dispatchCount).toBe(1);
  });

  it("never sends a reminder for a suppressed request", async () => {
    const { order, staffUser, proofRequestId } = await sendSingleGroup();
    await suppressProofReminder({
      shopId: order.shopId,
      proofRequestId,
      reason: "Suppressed before due.",
      staffUserId: staffUser.id,
    });
    await db.proofReminder.updateMany({
      where: { proofRequestId },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });

    await dispatchDueProofReminders();

    const reminder = await db.proofReminder.findUniqueOrThrow({ where: { proofRequestId } });
    expect(reminder.sentAt).toBeNull();
  });

  it("never sends a reminder for a completed request", async () => {
    const { proofGroupId, proofRequestId, order, staffUser } = await sendSingleGroup();
    void proofGroupId;
    void order;
    void staffUser;

    // Mark the request COMPLETED directly (the status recordCustomerProofResponse
    // would set once every included group resolves) and confirm the reminder
    // poller skips it — this test is about the poller's own eligibility
    // check, not re-testing how a request reaches COMPLETED.
    await db.proofRequest.update({ where: { id: proofRequestId }, data: { status: "COMPLETED" } });
    await db.proofReminder.updateMany({
      where: { proofRequestId },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });

    await dispatchDueProofReminders();

    const reminder = await db.proofReminder.findUniqueOrThrow({ where: { proofRequestId } });
    expect(reminder.sentAt).toBeNull();
  });

  it("never sends a reminder for a cancelled order", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const { proofGroupId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
    });
    const sendResult = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      staffMessage: null,
      staffUserId: staffUser.id,
    });
    if (sendResult.outcome !== "sent") throw new Error("setup failed");

    await db.shopifyOrder.update({ where: { id: order.id }, data: { cancelledAt: new Date() } });
    await db.proofReminder.updateMany({
      where: { proofRequestId: sendResult.proofRequestId },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });

    await dispatchDueProofReminders();

    const reminder = await db.proofReminder.findUniqueOrThrow({
      where: { proofRequestId: sendResult.proofRequestId },
    });
    expect(reminder.sentAt).toBeNull();
  });

  it("never sends a reminder for a revoked request", async () => {
    const { order, staffUser, proofRequestId } = await sendSingleGroup();
    const { revokeProofRequest } = await import("~/domain/proofs/revoke-proof-request.server");
    await revokeProofRequest({
      shopId: order.shopId,
      proofRequestId,
      reason: "Revoked.",
      staffUserId: staffUser.id,
    });
    await db.proofReminder.updateMany({
      where: { proofRequestId },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });

    await dispatchDueProofReminders();

    const reminder = await db.proofReminder.findUniqueOrThrow({ where: { proofRequestId } });
    expect(reminder.sentAt).toBeNull();
  });

  it("never sends a reminder for an expired request", async () => {
    const { proofRequestId } = await sendSingleGroup();
    await db.proofRequest.update({
      where: { id: proofRequestId },
      data: { tokenExpiresAt: new Date(Date.now() - 1000) },
    });
    await db.proofReminder.updateMany({
      where: { proofRequestId },
      data: { scheduledFor: new Date(Date.now() - 2000) },
    });

    await dispatchDueProofReminders();

    const reminder = await db.proofReminder.findUniqueOrThrow({ where: { proofRequestId } });
    expect(reminder.sentAt).toBeNull();
  });
});
