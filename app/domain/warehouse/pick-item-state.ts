import type { WarehousePickItemStatus } from "@prisma/client";

// A WarehousePickItem's status is always DERIVED from its own quantities —
// never hand-set directly. PENDING until anything is recorded; PICKED once
// the full required quantity has genuinely been gathered; SHORT once the
// picked and short quantities together account for the full required
// quantity but the item itself is short (see mark-pick-item-short.server.ts,
// the only writer of shortQuantity); IN_PROGRESS for a partial pick still
// expecting more.

export function derivePickItemStatus(
  pickedQuantity: number,
  shortQuantity: number,
  requiredQuantity: number,
): WarehousePickItemStatus {
  if (pickedQuantity === requiredQuantity) {
    return "PICKED";
  }
  if (shortQuantity > 0 && pickedQuantity + shortQuantity === requiredQuantity) {
    return "SHORT";
  }
  if (pickedQuantity === 0 && shortQuantity === 0) {
    return "PENDING";
  }
  return "IN_PROGRESS";
}
