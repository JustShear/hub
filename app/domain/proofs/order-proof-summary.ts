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
  /** True when the group's status is SENT or VIEWED — sent to the customer, no terminal response yet (Milestone 09). */
  isWaitingOnCustomer: boolean;
  /** True when the group's status is APPROVED — locked, customer has signed off (Milestone 09). */
  isApproved: boolean;
  /** True when the group's status is CHANGES_REQUESTED (Milestone 09). */
  isChangesRequested: boolean;
  /** True when the group's status is READY_FOR_EXPORT — production artwork prepared, not yet exported (Milestone 10). */
  isReadyForExport: boolean;
  /** True when the group's status is EXPORTED_FOR_PRINT (Milestone 10). */
  isExportedForPrint: boolean;
}

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

  // A customer change-request is reported as its own distinct value rather
  // than folded into BLOCKED — BLOCKED is reserved for a storage/integration
  // problem the customer had no part in; CHANGES_REQUESTED is honest about
  // whose action is actually needed next (artwork staff, on customer
  // feedback), which BLOCKED would obscure.
  if (requiredGroups.some((g) => g.isChangesRequested)) {
    return "CHANGES_REQUESTED";
  }

  // Exported states take precedence over approved states — a group that
  // has progressed to READY_FOR_EXPORT/EXPORTED_FOR_PRINT is further along
  // than plain APPROVED, not a regression from it. There is no distinct
  // "ready for export, not yet exported" order-level value — that
  // intermediate step is only visible at the individual ProofGroup.status
  // level; the order-level rollup only distinguishes approved vs exported.
  if (requiredGroups.every((g) => g.isExportedForPrint)) {
    return "ALL_REQUIRED_PROOFS_EXPORTED";
  }

  if (requiredGroups.some((g) => g.isExportedForPrint)) {
    return "PARTIALLY_EXPORTED";
  }

  if (requiredGroups.every((g) => g.isApproved || g.isReadyForExport)) {
    return "ALL_REQUIRED_PROOFS_APPROVED";
  }

  if (requiredGroups.some((g) => g.isApproved || g.isReadyForExport)) {
    return "PARTIALLY_APPROVED";
  }

  if (requiredGroups.every((g) => g.isReadyToSend)) {
    return "READY_TO_SEND";
  }

  if (requiredGroups.some((g) => g.isWaitingOnCustomer)) {
    return "WAITING_ON_CUSTOMER";
  }

  if (requiredGroups.some((g) => g.hasAnyVersion)) {
    return "PROOFS_IN_PROGRESS";
  }

  return "PROOFS_NOT_STARTED";
}
