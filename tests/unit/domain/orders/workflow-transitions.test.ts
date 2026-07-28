import { describe, expect, it } from "vitest";
import { OrderStatus } from "@prisma/client";
import { canMoveOrderToColumn } from "~/domain/orders/workflow-transitions";

describe("canMoveOrderToColumn", () => {
  it("allows moves between the four interactive columns", () => {
    expect(canMoveOrderToColumn(OrderStatus.NEW, "proof_being_prepared")).toMatchObject({
      allowed: true,
    });
    expect(
      canMoveOrderToColumn(OrderStatus.PROOFING_IN_PROGRESS, "waiting_on_customer"),
    ).toMatchObject({ allowed: true });
    expect(canMoveOrderToColumn(OrderStatus.WAITING_CUSTOMER, "proof_approved")).toMatchObject({
      allowed: true,
    });
    expect(canMoveOrderToColumn(OrderStatus.READY_FOR_EXPORT, "new")).toMatchObject({
      allowed: true,
    });
  });

  it("rejects moving to Changes Requested, Proof Sent, or Exported for Print — not manually draggable", () => {
    for (const target of ["changes_requested", "proof_sent", "exported_for_print"] as const) {
      const result = canMoveOrderToColumn(OrderStatus.NEW, target);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeTruthy();
    }
  });

  it("rejects any move for an on-hold, cancelled, or archived order", () => {
    for (const status of [OrderStatus.ON_HOLD, OrderStatus.CANCELLED, OrderStatus.ARCHIVED]) {
      const result = canMoveOrderToColumn(status, "new");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/on hold, cancelled, or archived/i);
    }
  });
});
