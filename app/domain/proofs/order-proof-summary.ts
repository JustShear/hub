import type { OrderProofSummary } from "@prisma/client";

// Pure calculation — centralises the one rule for what ShopifyOrder.proofSummary
// should be, so no caller ever hand-picks a value. Input is always the
// order's NON-CANCELLED proof groups; cancelled groups are excluded by the
// caller before this function ever sees them.
export interface ProofGroupSummaryInput {
  /** True once the group's own status reached READY_TO_SEND. */
  isReadyToSend: boolean;
  /** True once the group has at least one non-cancelled proof version. */
  hasAnyVersion: boolean;
  /** True when the group's requirement decision is NO_PROOF_REQUIRED. */
  isNoProofRequired: boolean;
  /** True when this group has an open (unresolved) IntegrationFailure attached. */
  hasOpenIntegrationFailure: boolean;
}

// Milestone 08 only ever produces this subset — WAITING_ON_CUSTOMER,
// CHANGES_REQUESTED, PARTIALLY_APPROVED, ALL_REQUIRED_PROOFS_APPROVED,
// PARTIALLY_EXPORTED, and ALL_REQUIRED_PROOFS_EXPORTED all remain valid
// enum members for later milestones but are never written here.
export function calculateOrderProofSummary(
  nonCancelledGroups: ProofGroupSummaryInput[],
): OrderProofSummary {
  if (nonCancelledGroups.length === 0) {
    return "PROOFS_NOT_STARTED";
  }

  const requiredGroups = nonCancelledGroups.filter((g) => !g.isNoProofRequired);

  if (requiredGroups.length === 0) {
    // Every remaining group is legitimately marked no-proof-required.
    return "NO_PROOFS_REQUIRED";
  }

  if (requiredGroups.some((g) => g.hasOpenIntegrationFailure)) {
    return "BLOCKED";
  }

  if (requiredGroups.every((g) => g.isReadyToSend)) {
    return "READY_TO_SEND";
  }

  if (requiredGroups.some((g) => g.hasAnyVersion)) {
    return "PROOFS_IN_PROGRESS";
  }

  return "PROOFS_NOT_STARTED";
}
