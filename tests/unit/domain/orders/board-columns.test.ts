import { describe, expect, it } from "vitest";
import { OrderStatus } from "@prisma/client";
import {
  BOARD_COLUMNS,
  getBoardColumn,
  getBoardColumnKey,
  getInteractiveColumnKeys,
  isSpecialStatus,
  type BoardOrderLike,
} from "~/domain/orders/board-columns";

function order(overrides: Partial<BoardOrderLike> = {}): BoardOrderLike {
  return { workflowStatus: OrderStatus.NEW, tags: [], ...overrides };
}

describe("BOARD_COLUMNS display order", () => {
  it("matches the requested left-to-right column order", () => {
    expect(BOARD_COLUMNS.map((c) => c.key)).toEqual([
      "new",
      "order_sheet_printed",
      "pre_order",
      "waiting_on_customer",
      "proof_being_prepared",
      "proof_sent",
      "changes_requested",
      "proof_approved",
      "exported_for_print",
      "pack",
    ]);
  });
});

describe("getBoardColumnKey", () => {
  it("maps NEW with no tags to New", () => {
    expect(getBoardColumnKey(order({ workflowStatus: OrderStatus.NEW }))).toBe("new");
  });

  it("maps ARTWORK_REQUIRED, PROOFING_IN_PROGRESS, and WAITING_CUSTOMER to Proof Being Prepared", () => {
    for (const status of [
      OrderStatus.ARTWORK_REQUIRED,
      OrderStatus.PROOFING_IN_PROGRESS,
      OrderStatus.WAITING_CUSTOMER,
    ]) {
      expect(getBoardColumnKey(order({ workflowStatus: status }))).toBe("proof_being_prepared");
    }
  });

  it('maps the "p" tag to Order Sheet Printed', () => {
    expect(getBoardColumnKey(order({ tags: ["p"] }))).toBe("order_sheet_printed");
  });

  it('maps the "emailed" tag to Waiting on Customer', () => {
    expect(getBoardColumnKey(order({ tags: ["emailed"] }))).toBe("waiting_on_customer");
  });

  it('maps the "proof_sent" tag to Proof Sent', () => {
    expect(getBoardColumnKey(order({ tags: ["proof_sent"] }))).toBe("proof_sent");
  });

  it('maps the "proof_rejected" tag to Changes Requested', () => {
    expect(getBoardColumnKey(order({ tags: ["proof_rejected"] }))).toBe("changes_requested");
  });

  it('maps the "proof_accepted" tag to Proof Approved', () => {
    expect(getBoardColumnKey(order({ tags: ["proof_accepted"] }))).toBe("proof_approved");
  });

  it('maps the "Exported for Print" tag to Exported for Print', () => {
    expect(getBoardColumnKey(order({ tags: ["Exported for Print"] }))).toBe("exported_for_print");
  });

  it("maps READY_TO_PACK and PACKING workflow status to Pack", () => {
    expect(getBoardColumnKey(order({ workflowStatus: OrderStatus.READY_TO_PACK }))).toBe("pack");
    expect(getBoardColumnKey(order({ workflowStatus: OrderStatus.PACKING }))).toBe("pack");
  });

  it("maps PRE_ORDER workflow status to Pre-Order", () => {
    expect(getBoardColumnKey(order({ workflowStatus: OrderStatus.PRE_ORDER }))).toBe("pre_order");
  });

  it("returns null for on-hold, cancelled, archived, and fulfilled orders — never on the main board", () => {
    for (const status of [
      OrderStatus.ON_HOLD,
      OrderStatus.CANCELLED,
      OrderStatus.ARCHIVED,
      OrderStatus.FULFILLED,
    ]) {
      expect(getBoardColumnKey(order({ workflowStatus: status }))).toBeNull();
    }
  });

  it("never orphans a non-special OrderStatus with no tags into no column", () => {
    for (const status of Object.values(OrderStatus)) {
      if (isSpecialStatus(status)) continue;
      expect(getBoardColumnKey(order({ workflowStatus: status }))).not.toBeNull();
    }
  });

  describe("match priority when multiple signals coexist on one order", () => {
    it("Pack (workflowStatus) outranks every tag", () => {
      expect(
        getBoardColumnKey(
          order({ workflowStatus: OrderStatus.READY_TO_PACK, tags: ["Exported for Print"] }),
        ),
      ).toBe("pack");
    });

    it("Exported for Print outranks proof_accepted", () => {
      expect(
        getBoardColumnKey(order({ tags: ["proof_accepted", "Exported for Print"] })),
      ).toBe("exported_for_print");
    });

    it("proof_accepted outranks proof_rejected", () => {
      expect(getBoardColumnKey(order({ tags: ["proof_rejected", "proof_accepted"] }))).toBe(
        "proof_approved",
      );
    });

    it("proof_rejected outranks proof_sent", () => {
      expect(getBoardColumnKey(order({ tags: ["proof_sent", "proof_rejected"] }))).toBe(
        "changes_requested",
      );
    });

    it("proof_sent outranks emailed", () => {
      expect(getBoardColumnKey(order({ tags: ["emailed", "proof_sent"] }))).toBe("proof_sent");
    });

    it("emailed outranks p", () => {
      expect(getBoardColumnKey(order({ tags: ["p", "emailed"] }))).toBe("waiting_on_customer");
    });

    it('a stray "p" tag alongside a later-stage tag resolves to the later stage, not Order Sheet Printed', () => {
      expect(getBoardColumnKey(order({ tags: ["p", "proof_accepted"] }))).toBe("proof_approved");
    });

    it("proof_being_prepared (workflowStatus) outranks the New catch-all", () => {
      expect(getBoardColumnKey(order({ workflowStatus: OrderStatus.PROOFING_IN_PROGRESS }))).toBe(
        "proof_being_prepared",
      );
    });

    it('a "p" tag outranks PRE_ORDER workflow status — real progress graduates the order out of Pre-Order', () => {
      expect(
        getBoardColumnKey(order({ workflowStatus: OrderStatus.PRE_ORDER, tags: ["p"] })),
      ).toBe("order_sheet_printed");
    });

    it("PRE_ORDER outranks the New catch-all", () => {
      expect(getBoardColumnKey(order({ workflowStatus: OrderStatus.PRE_ORDER }))).toBe(
        "pre_order",
      );
    });
  });
});

describe("getBoardColumn", () => {
  it("throws for an unknown column key", () => {
    // @ts-expect-error intentionally invalid key
    expect(() => getBoardColumn("not_a_real_column")).toThrow();
  });

  it("marks the five purely-tag-driven columns as non-interactive", () => {
    for (const key of [
      "order_sheet_printed",
      "waiting_on_customer",
      "proof_sent",
      "changes_requested",
      "proof_approved",
    ] as const) {
      expect(getBoardColumn(key).interactive).toBe(false);
      expect(getBoardColumn(key).readOnlyReason).toBeTruthy();
    }
  });

  it("marks New, Pre-Order, Proof Being Prepared, Exported for Print, and Pack as interactive", () => {
    expect(getBoardColumn("new").interactive).toBe(true);
    expect(getBoardColumn("pre_order").interactive).toBe(true);
    expect(getBoardColumn("proof_being_prepared").interactive).toBe(true);
    expect(getBoardColumn("exported_for_print").interactive).toBe(true);
    expect(getBoardColumn("pack").interactive).toBe(true);
  });

  it("gives Exported for Print a shopifyTag drop action, add-only (no removeTags)", () => {
    const column = getBoardColumn("exported_for_print");
    expect(column.dropAction).toEqual({
      type: "shopifyTag",
      addTag: "Exported for Print",
      removeTags: [],
    });
  });

  it("gives Pre-Order a workflowStatus drop action", () => {
    const column = getBoardColumn("pre_order");
    expect(column.dropAction).toEqual({ type: "workflowStatus", status: OrderStatus.PRE_ORDER });
  });
});

describe("getInteractiveColumnKeys", () => {
  it("returns exactly the five draggable columns", () => {
    expect(getInteractiveColumnKeys().sort()).toEqual(
      ["new", "pre_order", "proof_being_prepared", "exported_for_print", "pack"].sort(),
    );
  });
});
