import type { WarehousePickItemStatus, WarehousePickJobStatus } from "@prisma/client";

// Handover to packing is the one explicit terminal staff action for a
// WarehousePickJob. A short item does NOT block handover (an explicit
// scope decision — short picks allow partial handover with a flagged
// shortage) but a PENDING or IN_PROGRESS item does: every item must have
// been actively worked before the job can be handed over, even if the
// outcome for some of them was "short."

export interface HandoverEligibilityItemInput {
  status: WarehousePickItemStatus;
}

export interface HandoverEligibilityResult {
  eligible: boolean;
  reason?: string;
}

export function evaluateHandoverEligibility(
  jobStatus: WarehousePickJobStatus,
  items: HandoverEligibilityItemInput[],
): HandoverEligibilityResult {
  if (jobStatus === "CANCELLED") {
    return { eligible: false, reason: "This pick job has been cancelled." };
  }
  if (jobStatus === "HANDED_OVER") {
    return { eligible: false, reason: "This pick job has already been handed over." };
  }
  const unfinished = items.filter((i) => i.status === "PENDING" || i.status === "IN_PROGRESS");
  if (unfinished.length > 0) {
    return {
      eligible: false,
      reason: `${unfinished.length} line(s) still need to be picked or marked short before handover.`,
    };
  }
  return { eligible: true };
}
