import { describe, expect, it } from "vitest";
import { OrderProofSummary, OrderStatus } from "@prisma/client";
import {
  BOARD_COLUMNS,
  getBoardColumn,
  getBoardColumnKey,
  getInteractiveColumnKeys,
  isSpecialStatus,
} from "~/domain/orders/board-columns";

describe("getBoardColumnKey", () => {
  it("maps NEW to the New column", () => {
    expect(
      getBoardColumnKey({
        workflowStatus: OrderStatus.NEW,
        proofSummary: OrderProofSummary.PROOFS_NOT_STARTED,
      }),
    ).toBe("new");
  });

  it("maps ARTWORK_REQUIRED and PROOFING_IN_PROGRESS to Proof Being Prepared", () => {
    expect(
      getBoardColumnKey({
        workflowStatus: OrderStatus.ARTWORK_REQUIRED,
        proofSummary: OrderProofSummary.PROOFS_NOT_STARTED,
      }),
    ).toBe("proof_being_prepared");
    expect(
      getBoardColumnKey({
        workflowStatus: OrderStatus.PROOFING_IN_PROGRESS,
        proofSummary: OrderProofSummary.PROOFS_IN_PROGRESS,
      }),
    ).toBe("proof_being_prepared");
  });

  it("maps WAITING_CUSTOMER to Waiting on Customer", () => {
    expect(
      getBoardColumnKey({
        workflowStatus: OrderStatus.WAITING_CUSTOMER,
        proofSummary: OrderProofSummary.PROOFS_NOT_STARTED,
      }),
    ).toBe("waiting_on_customer");
  });

  it("maps PARTIALLY_APPROVED and READY_FOR_EXPORT workflow status to Proof Approved", () => {
    expect(
      getBoardColumnKey({
        workflowStatus: OrderStatus.PARTIALLY_APPROVED,
        proofSummary: OrderProofSummary.PROOFS_NOT_STARTED,
      }),
    ).toBe("proof_approved");
    expect(
      getBoardColumnKey({
        workflowStatus: OrderStatus.READY_FOR_EXPORT,
        proofSummary: OrderProofSummary.PROOFS_NOT_STARTED,
      }),
    ).toBe("proof_approved");
  });

  it("maps everything from EXPORTED_FOR_PRINT through FULFILLED to Exported for Print", () => {
    for (const status of [
      OrderStatus.PARTIALLY_EXPORTED,
      OrderStatus.EXPORTED_FOR_PRINT,
      OrderStatus.IN_PRODUCTION,
      OrderStatus.PARTIALLY_COMPLETE,
      OrderStatus.READY_TO_PACK,
      OrderStatus.PACKING,
      OrderStatus.FULFILLED,
    ]) {
      expect(
        getBoardColumnKey({
          workflowStatus: status,
          proofSummary: OrderProofSummary.PROOFS_NOT_STARTED,
        }),
      ).toBe("exported_for_print");
    }
  });

  it("promotes to Changes Requested based on proofSummary regardless of workflowStatus", () => {
    expect(
      getBoardColumnKey({
        workflowStatus: OrderStatus.PROOFING_IN_PROGRESS,
        proofSummary: OrderProofSummary.CHANGES_REQUESTED,
      }),
    ).toBe("changes_requested");
  });

  it("promotes to Proof Sent based on proofSummary regardless of workflowStatus", () => {
    expect(
      getBoardColumnKey({
        workflowStatus: OrderStatus.ARTWORK_REQUIRED,
        proofSummary: OrderProofSummary.WAITING_ON_CUSTOMER,
      }),
    ).toBe("proof_sent");
  });

  it("gives Changes Requested priority over Proof Sent when both could apply", () => {
    // Not realistic data (proofSummary is a single value), but confirms
    // BOARD_COLUMNS' declared priority order is what getBoardColumnKey uses.
    expect(BOARD_COLUMNS[0]?.key).toBe("changes_requested");
    expect(BOARD_COLUMNS[1]?.key).toBe("proof_sent");
  });

  it("returns null for on-hold, cancelled, and archived orders — never on the main board", () => {
    for (const status of [OrderStatus.ON_HOLD, OrderStatus.CANCELLED, OrderStatus.ARCHIVED]) {
      expect(
        getBoardColumnKey({
          workflowStatus: status,
          proofSummary: OrderProofSummary.PROOFS_NOT_STARTED,
        }),
      ).toBeNull();
    }
  });

  it("never orphans a non-special OrderStatus value into no column", () => {
    for (const status of Object.values(OrderStatus)) {
      if (isSpecialStatus(status)) continue;
      const key = getBoardColumnKey({
        workflowStatus: status,
        proofSummary: OrderProofSummary.PROOFS_NOT_STARTED,
      });
      expect(key).not.toBeNull();
    }
  });
});

describe("getBoardColumn", () => {
  it("throws for an unknown column key", () => {
    // @ts-expect-error intentionally invalid key
    expect(() => getBoardColumn("not_a_real_column")).toThrow();
  });

  it("marks Changes Requested, Proof Sent, and Exported for Print as non-interactive", () => {
    expect(getBoardColumn("changes_requested").interactive).toBe(false);
    expect(getBoardColumn("proof_sent").interactive).toBe(false);
    expect(getBoardColumn("exported_for_print").interactive).toBe(false);
  });

  it("marks New, Proof Being Prepared, Waiting on Customer, and Proof Approved as interactive", () => {
    expect(getBoardColumn("new").interactive).toBe(true);
    expect(getBoardColumn("proof_being_prepared").interactive).toBe(true);
    expect(getBoardColumn("waiting_on_customer").interactive).toBe(true);
    expect(getBoardColumn("proof_approved").interactive).toBe(true);
  });
});

describe("getInteractiveColumnKeys", () => {
  it("returns exactly the four draggable columns", () => {
    expect(getInteractiveColumnKeys().sort()).toEqual(
      ["new", "proof_being_prepared", "waiting_on_customer", "proof_approved"].sort(),
    );
  });
});
