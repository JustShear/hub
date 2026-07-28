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
}

export function summarizeProofGroupsForBoard(groups: BoardProofGroupInput[]): BoardProofSummary {
  const active = groups.filter((g) => g.status !== "CANCELLED");
  const noProofRequired = active.filter((g) => g.status === "NO_PROOF_REQUIRED");
  const blocked = active.filter((g) => g.hasOpenIntegrationFailure);
  const ready = active.filter((g) => g.status === "READY_TO_SEND");
  const requiringWork = active.filter(
    (g) =>
      g.status !== "NO_PROOF_REQUIRED" &&
      g.status !== "READY_TO_SEND" &&
      !g.hasOpenIntegrationFailure,
  );

  return {
    activeGroupCount: active.length,
    readyCount: ready.length,
    requiringWorkCount: requiringWork.length,
    noProofRequiredCount: noProofRequired.length,
    blockedCount: blocked.length,
  };
}
