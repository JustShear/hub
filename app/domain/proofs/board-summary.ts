import type { ProofGroupStatus } from "@prisma/client";

// Pure aggregation over a card's already-loaded proof groups — no query
// logic here, so board-query.server.ts (real DB shape) and any test (a
// plain array of fixtures) exercise the exact same counting rules.
export interface BoardProofGroupInput {
  status: ProofGroupStatus;
  hasOpenIntegrationFailure: boolean;
}

export interface BoardProofSummary {
  activeGroupCount: number;
  readyCount: number;
  requiringWorkCount: number;
  noProofRequiredCount: number;
  blockedCount: number;
  /** SENT or VIEWED — sent to the customer, no terminal response yet (Milestone 09). */
  waitingOnCustomerCount: number;
  /** CHANGES_REQUESTED (Milestone 09) — the customer asked for changes; artwork staff need to act. */
  changesRequestedCount: number;
  /** APPROVED (Milestone 09) — locked, no further staff action needed unless reopened. */
  approvedCount: number;
  /** READY_FOR_EXPORT (Milestone 10) — production artwork prepared, awaiting the export action. */
  readyForExportCount: number;
  /** EXPORTED_FOR_PRINT (Milestone 10). */
  exportedCount: number;
}

export function summarizeProofGroupsForBoard(groups: BoardProofGroupInput[]): BoardProofSummary {
  const active = groups.filter((g) => g.status !== "CANCELLED");
  const noProofRequired = active.filter((g) => g.status === "NO_PROOF_REQUIRED");
  const blocked = active.filter((g) => g.hasOpenIntegrationFailure);
  const ready = active.filter((g) => g.status === "READY_TO_SEND");
  const waitingOnCustomer = active.filter((g) => g.status === "SENT" || g.status === "VIEWED");
  const changesRequested = active.filter((g) => g.status === "CHANGES_REQUESTED");
  const approved = active.filter((g) => g.status === "APPROVED");
  const readyForExport = active.filter((g) => g.status === "READY_FOR_EXPORT");
  const exported = active.filter((g) => g.status === "EXPORTED_FOR_PRINT");
  // Pre-send work only: NOT_STARTED/DRAFT_IN_PROGRESS and not already
  // counted as blocked — every bucket here is mutually exclusive so the
  // counts can be summed on a card without double-counting a group.
  const requiringWork = active.filter(
    (g) =>
      (g.status === "NOT_STARTED" || g.status === "DRAFT_IN_PROGRESS") &&
      !g.hasOpenIntegrationFailure,
  );

  return {
    activeGroupCount: active.length,
    readyCount: ready.length,
    requiringWorkCount: requiringWork.length,
    noProofRequiredCount: noProofRequired.length,
    blockedCount: blocked.length,
    waitingOnCustomerCount: waitingOnCustomer.length,
    changesRequestedCount: changesRequested.length,
    approvedCount: approved.length,
    readyForExportCount: readyForExport.length,
    exportedCount: exported.length,
  };
}
