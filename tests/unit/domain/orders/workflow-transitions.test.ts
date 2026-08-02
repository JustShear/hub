import { describe, expect, it } from "vitest";
import { OrderStatus } from "@prisma/client";
import { canMoveOrderToColumn } from "~/domain/orders/workflow-transitions";

describe("canMoveOrderToColumn", () => {
  it("allows moves between the three interactive columns", () => {
    expect(canMoveOrderToColumn(OrderStatus.NEW, "proof_being_prepared")).toMatchObject({
      allowed: true,
    });
    expect(canMoveOrderToColumn(OrderStatus.PROOFING_IN_PROGRESS, "pack")).toMatchObject({
      allowed: true,
    });
    expect(canMoveOrderToColumn(OrderStatus.READY_TO_PACK, "new")).toMatchObject({
      allowed: true,
    });
  });

  it("rejects moving to any of the six tag-driven columns — not manually draggable", () => {
    for (const target of [
      "order_sheet_printed",
      "waiting_on_customer",
      "proof_sent",
      "changes_requested",
      "proof_approved",
      "exported_for_print",
    ] as const) {
      const result = canMoveOrderToColumn(OrderStatus.NEW, target);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeTruthy();
    }
  });

  it("rejects any move for an on-hold, cancelled, archived, or fulfilled order", () => {
    for (const status of [
      OrderStatus.ON_HOLD,
      OrderStatus.CANCELLED,
      OrderStatus.ARCHIVED,
      OrderStatus.FULFILLED,
    ]) {
      const result = canMoveOrderToColumn(status, "new");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/on hold, cancelled, archived, or fulfilled/i);
    }
  });
});
