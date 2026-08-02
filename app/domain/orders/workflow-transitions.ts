import type { OrderStatus } from "@prisma/client";
import {
  getBoardColumn,
  isSpecialStatus,
  type BoardColumnKey,
} from "~/domain/orders/board-columns";

export interface TransitionCheckResult {
  allowed: boolean;
  reason?: string;
}

// The single, server-authoritative transition policy. The client calls this
// too (to grey out invalid drop targets and build the "Move to" menu), but
// that's a UX convenience only — the server action calls it independently
// and never trusts what the client sent.
//
// Deliberately permissive beyond these checks: proofing business rules
// (e.g. requiring an approved version before export) land in later
// milestones once proof groups/versions actually exist.
export function canMoveOrderToColumn(
  currentWorkflowStatus: OrderStatus,
  targetColumnKey: BoardColumnKey,
): TransitionCheckResult {
  if (isSpecialStatus(currentWorkflowStatus)) {
    return {
      allowed: false,
      reason:
        "This order is on hold, cancelled, archived, or fulfilled. Reactivating it into the active workflow isn't supported from the board yet.",
    };
  }

  const targetColumn = getBoardColumn(targetColumnKey);
  if (!targetColumn.interactive || !targetColumn.dropSetsWorkflowStatus) {
    return {
      allowed: false,
      reason: targetColumn.readOnlyReason ?? `${targetColumn.label} can't be set from the board.`,
    };
  }

  return { allowed: true };
}
