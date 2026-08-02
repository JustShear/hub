import type { ExceptionCaseStatus } from "@prisma/client";

// Centralised exception-case transition rules — no DB access, so both the
// UI (to grey out unavailable actions) and every server action call the
// exact same logic. Server-side validation inside the transaction is always
// the real guard; this is the shared source of truth for what it checks.
//
// ExceptionCase.status is hand-set via explicit staff transitions, not
// derived — unlike ProductionJobStatus/WarehousePickJobStatus, there's no
// multi-child rollup here (a case has at most one active resolution),
// matching ProofGroup.status/ProductionIssueStatus's own directly-set style.

export interface CaseTransitionResult {
  allowed: boolean;
  reason?: string;
}

const TERMINAL_STATUSES: ReadonlySet<ExceptionCaseStatus> = new Set(["RESOLVED", "CANCELLED"]);

export function isTerminalCaseStatus(status: ExceptionCaseStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

const FORWARD_TRANSITIONS: Record<ExceptionCaseStatus, ReadonlySet<ExceptionCaseStatus>> = {
  OPEN: new Set(["INVESTIGATING", "AWAITING_CUSTOMER", "RESOLVED"]),
  INVESTIGATING: new Set(["AWAITING_CUSTOMER", "RESOLVED"]),
  AWAITING_CUSTOMER: new Set(["INVESTIGATING", "RESOLVED"]),
  RESOLVED: new Set(),
  CANCELLED: new Set(),
};

/**
 * Validates a case status transition. CANCELLED is reachable from any
 * non-terminal state (handled separately by the caller, which always
 * requires a reason) — this only governs the OPEN/INVESTIGATING/
 * AWAITING_CUSTOMER/RESOLVED forward path.
 */
export function validateCaseStatusTransition(
  current: ExceptionCaseStatus,
  target: Exclude<ExceptionCaseStatus, "CANCELLED">,
): CaseTransitionResult {
  if (isTerminalCaseStatus(current)) {
    return { allowed: false, reason: "This case has already reached a terminal status." };
  }
  if (!FORWARD_TRANSITIONS[current].has(target)) {
    return {
      allowed: false,
      reason: `A case can't move from ${current.toLowerCase()} to ${target.toLowerCase()}.`,
    };
  }
  return { allowed: true };
}

export function canCancelCase(current: ExceptionCaseStatus): CaseTransitionResult {
  if (isTerminalCaseStatus(current)) {
    return { allowed: false, reason: "This case has already reached a terminal status." };
  }
  return { allowed: true };
}
