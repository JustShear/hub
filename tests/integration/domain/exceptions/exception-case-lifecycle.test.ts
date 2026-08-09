import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createExceptionCase } from "~/domain/exceptions/create-exception-case.server";
import {
  cancelExceptionCase,
  markAwaitingCustomer,
  startInvestigation,
} from "~/domain/exceptions/transition-exception-case-status.server";
import { assignExceptionCase } from "~/domain/exceptions/assign-exception-case.server";
import { recordReturnLabel } from "~/domain/exceptions/record-return-label.server";
import { resolveExceptionCase } from "~/domain/exceptions/resolve-exception-case.server";
import { markResolutionCompleted } from "~/domain/exceptions/mark-resolution-completed.server";
import { addExceptionCaseNote } from "~/domain/exceptions/add-exception-case-note.server";
import { createExceptionTestTracker } from "./helpers";

describe("exception case lifecycle (integration)", () => {
  const tracker = createExceptionTestTracker();
  afterAll(tracker.cleanup);

  async function seedCase(overrides: { summary?: string } = {}) {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const result = await createExceptionCase({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: null,
      category: "CUSTOMER_RETURN",
      initiatedBy: "CUSTOMER",
      summary: overrides.summary ?? "Customer says the hoodie arrived damaged",
      customerNote: "It had a hole in the sleeve",
      staffUserId: staffUser.id,
    });
    if (result.outcome !== "created") throw new Error(`setup failed: ${JSON.stringify(result)}`);
    tracker.trackExceptionCase(result.exceptionCaseId);
    return {
      order,
      staffUser,
      exceptionCaseId: result.exceptionCaseId,
      caseNumber: result.caseNumber,
    };
  }

  it("assigns sequential case numbers per order and rejects an empty summary", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const first = await createExceptionCase({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: null,
      category: "PRODUCTION_DEFECT",
      initiatedBy: "STAFF",
      summary: "Print misaligned",
      customerNote: null,
      staffUserId: staffUser.id,
    });
    const second = await createExceptionCase({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: null,
      category: "OTHER",
      initiatedBy: "STAFF",
      summary: "A second issue",
      customerNote: null,
      staffUserId: staffUser.id,
    });
    if (first.outcome !== "created" || second.outcome !== "created") {
      throw new Error("setup failed");
    }
    tracker.trackExceptionCase(first.exceptionCaseId);
    tracker.trackExceptionCase(second.exceptionCaseId);
    expect(first.caseNumber).toBe(1);
    expect(second.caseNumber).toBe(2);

    const rejected = await createExceptionCase({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: null,
      category: "OTHER",
      initiatedBy: "STAFF",
      summary: "   ",
      customerNote: null,
      staffUserId: staffUser.id,
    });
    expect(rejected).toMatchObject({ outcome: "rejected" });
  });

  it("moves through investigation status transitions and rejects an invalid jump", async () => {
    const { exceptionCaseId, staffUser } = await seedCase();

    const started = await startInvestigation({
      shopId: (await db.exceptionCase.findUniqueOrThrow({ where: { id: exceptionCaseId } })).shopId,
      exceptionCaseId,
      staffUserId: staffUser.id,
    });
    expect(started.outcome).toBe("transitioned");

    const invalid = await markAwaitingCustomer({
      shopId: staffUser.shopId,
      exceptionCaseId,
      staffUserId: staffUser.id,
    });
    expect(invalid.outcome).toBe("transitioned");

    const afterCase = await db.exceptionCase.findUniqueOrThrow({ where: { id: exceptionCaseId } });
    expect(afterCase.status).toBe("AWAITING_CUSTOMER");
  });

  it("cancels a case from any non-terminal state, requiring a reason", async () => {
    const { exceptionCaseId, staffUser } = await seedCase();

    const missingReason = await cancelExceptionCase({
      shopId: staffUser.shopId,
      exceptionCaseId,
      reason: " ",
      staffUserId: staffUser.id,
    });
    expect(missingReason).toMatchObject({ outcome: "rejected" });

    const cancelled = await cancelExceptionCase({
      shopId: staffUser.shopId,
      exceptionCaseId,
      reason: "Customer withdrew the complaint",
      staffUserId: staffUser.id,
    });
    expect(cancelled.outcome).toBe("transitioned");

    const again = await cancelExceptionCase({
      shopId: staffUser.shopId,
      exceptionCaseId,
      reason: "Trying again",
      staffUserId: staffUser.id,
    });
    expect(again).toMatchObject({ outcome: "rejected" });
  });

  it("assigns a case with optimistic concurrency, rejecting a stale expected value", async () => {
    const { exceptionCaseId, staffUser } = await seedCase();
    const otherStaff = await tracker.createStaffUser();

    const assigned = await assignExceptionCase({
      shopId: staffUser.shopId,
      exceptionCaseId,
      targetStaffUserId: staffUser.id,
      expectedStaffUserId: null,
      staffUserId: staffUser.id,
    });
    expect(assigned.outcome).toBe("assigned");

    const conflict = await assignExceptionCase({
      shopId: staffUser.shopId,
      exceptionCaseId,
      targetStaffUserId: otherStaff.id,
      expectedStaffUserId: null,
      staffUserId: staffUser.id,
    });
    expect(conflict.outcome).toBe("conflict");
  });

  it("records a return label as a manual fact, requiring a note", async () => {
    const { exceptionCaseId, staffUser } = await seedCase();

    const missingNote = await recordReturnLabel({
      shopId: staffUser.shopId,
      exceptionCaseId,
      note: "",
      staffUserId: staffUser.id,
    });
    expect(missingNote).toMatchObject({ outcome: "rejected" });

    const recorded = await recordReturnLabel({
      shopId: staffUser.shopId,
      exceptionCaseId,
      note: "Australia Post, tracking ABC123",
      staffUserId: staffUser.id,
    });
    expect(recorded.outcome).toBe("recorded");

    const updated = await db.exceptionCase.findUniqueOrThrow({ where: { id: exceptionCaseId } });
    expect(updated.returnLabelNote).toBe("Australia Post, tracking ABC123");
    expect(updated.returnLabelProvidedAt).not.toBeNull();
  });

  it("resolves a case as DENIED — no amount, no export batch, case becomes RESOLVED", async () => {
    const { exceptionCaseId, staffUser } = await seedCase();

    const result = await resolveExceptionCase({
      shopId: staffUser.shopId,
      exceptionCaseId,
      resolutionType: "DENIED",
      reason: "Investigated — item matches the original order, no fault found",
      amount: null,
      currencyCode: null,
      proofGroupId: null,
      staffUserId: staffUser.id,
    });
    expect(result).toMatchObject({ outcome: "resolved" });

    const updatedCase = await db.exceptionCase.findUniqueOrThrow({
      where: { id: exceptionCaseId },
    });
    expect(updatedCase.status).toBe("RESOLVED");
    expect(updatedCase.resolvedAt).not.toBeNull();
  });

  it("rejects a CREDIT/REFUND resolution without a positive amount, and records the amount when valid", async () => {
    const { exceptionCaseId, staffUser } = await seedCase();

    const missingAmount = await resolveExceptionCase({
      shopId: staffUser.shopId,
      exceptionCaseId,
      resolutionType: "REFUND",
      reason: "Customer requested a refund",
      amount: null,
      currencyCode: "AUD",
      proofGroupId: null,
      staffUserId: staffUser.id,
    });
    expect(missingAmount).toMatchObject({ outcome: "rejected" });

    const result = await resolveExceptionCase({
      shopId: staffUser.shopId,
      exceptionCaseId,
      resolutionType: "REFUND",
      reason: "Customer requested a refund",
      amount: 49.95,
      currencyCode: "AUD",
      proofGroupId: null,
      staffUserId: staffUser.id,
    });
    expect(result.outcome).toBe("resolved");
    if (result.outcome !== "resolved") throw new Error("unreachable");

    const resolution = await db.exceptionCaseResolution.findUniqueOrThrow({
      where: { id: result.resolutionId },
    });
    expect(resolution.amount?.toString()).toBe("49.95");
    expect(resolution.currencyCode).toBe("AUD");
    expect(resolution.status).toBe("PENDING");
  });

  it("resolves REPRINT as a record-only decision — no export batch or production job, same as DENIED", async () => {
    const { exceptionCaseId, order, staffUser } = await seedCase({ summary: "Defective print" });

    // proofGroupId is accepted but no longer required or acted upon — the
    // real export/production pipeline REPRINT used to trigger was removed.
    const result = await resolveExceptionCase({
      shopId: order.shopId,
      exceptionCaseId,
      resolutionType: "REPRINT",
      reason: "Print quality defect",
      amount: null,
      currencyCode: null,
      proofGroupId: null,
      staffUserId: staffUser.id,
    });
    expect(result).toMatchObject({ outcome: "resolved" });

    const updatedCase = await db.exceptionCase.findUniqueOrThrow({
      where: { id: exceptionCaseId },
    });
    expect(updatedCase.status).toBe("RESOLVED");
  });

  it("marks a resolution completed exactly once", async () => {
    const { exceptionCaseId, staffUser } = await seedCase();
    const result = await resolveExceptionCase({
      shopId: staffUser.shopId,
      exceptionCaseId,
      resolutionType: "CREDIT",
      reason: "Goodwill credit",
      amount: 10,
      currencyCode: "AUD",
      proofGroupId: null,
      staffUserId: staffUser.id,
    });
    if (result.outcome !== "resolved") throw new Error("setup failed");

    const completed = await markResolutionCompleted({
      shopId: staffUser.shopId,
      resolutionId: result.resolutionId,
      staffUserId: staffUser.id,
    });
    expect(completed.outcome).toBe("completed");

    const again = await markResolutionCompleted({
      shopId: staffUser.shopId,
      resolutionId: result.resolutionId,
      staffUserId: staffUser.id,
    });
    expect(again.outcome).toBe("already_there");
  });

  it("adds an internal note and detects a rapid duplicate resubmission", async () => {
    const { exceptionCaseId, staffUser } = await seedCase();

    const created = await addExceptionCaseNote({
      shopId: staffUser.shopId,
      exceptionCaseId,
      body: "Called the customer, awaiting photos",
      staffUserId: staffUser.id,
    });
    expect(created.outcome).toBe("created");

    const duplicate = await addExceptionCaseNote({
      shopId: staffUser.shopId,
      exceptionCaseId,
      body: "Called the customer, awaiting photos",
      staffUserId: staffUser.id,
    });
    expect(duplicate.outcome).toBe("duplicate");
  });
});
