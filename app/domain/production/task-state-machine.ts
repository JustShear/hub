import type { ProductionTaskStatus } from "@prisma/client";

// Centralised production-task transition rules — no DB access, so both the
// UI (to grey out unavailable actions) and every server action call the
// exact same logic. Server-side validation inside the transaction is always
// the real guard; this is the shared source of truth for what it checks.
//
// Task status is the one directly set by a staff action (start/pause/
// complete) — unlike ProductionJob.status and ShopifyOrder.productionSummary,
// which are always DERIVED from their children, never hand-set.

const TERMINAL_STATUSES: ReadonlySet<ProductionTaskStatus> = new Set([
  "COMPLETE",
  "FAILED",
  "CANCELLED",
]);

export function isTerminalTaskStatus(status: ProductionTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface TaskTransitionResult {
  allowed: boolean;
  reason?: string;
}

const START_FROM: ReadonlySet<ProductionTaskStatus> = new Set([
  "QUEUED",
  "READY",
  "PARTIALLY_COMPLETE",
]);

export function canStartTask(currentStatus: ProductionTaskStatus): TaskTransitionResult {
  if (!START_FROM.has(currentStatus)) {
    return {
      allowed: false,
      reason: `A task can only be started from queued, ready, or partially-complete — this one is ${currentStatus.toLowerCase()}.`,
    };
  }
  return { allowed: true };
}

export function canPauseTask(currentStatus: ProductionTaskStatus): TaskTransitionResult {
  if (currentStatus !== "IN_PROGRESS") {
    return { allowed: false, reason: "Only a task currently in progress can be paused." };
  }
  return { allowed: true };
}

export function canResumeTask(currentStatus: ProductionTaskStatus): TaskTransitionResult {
  if (currentStatus !== "PAUSED") {
    return { allowed: false, reason: "Only a paused task can be resumed." };
  }
  return { allowed: true };
}

const BLOCKABLE_FROM: ReadonlySet<ProductionTaskStatus> = new Set([
  "QUEUED",
  "READY",
  "IN_PROGRESS",
  "PAUSED",
  "PARTIALLY_COMPLETE",
  "AWAITING_QUALITY_CHECK",
]);

export function canBlockTask(currentStatus: ProductionTaskStatus): TaskTransitionResult {
  if (!BLOCKABLE_FROM.has(currentStatus)) {
    return { allowed: false, reason: "This task can't be blocked from its current status." };
  }
  return { allowed: true };
}

export function canUnblockTask(currentStatus: ProductionTaskStatus): TaskTransitionResult {
  if (currentStatus !== "BLOCKED") {
    return { allowed: false, reason: "Only a blocked task can be unblocked." };
  }
  return { allowed: true };
}

export interface DeriveTaskWorkingStatusInput {
  requiredQuantity: number;
  completedQuantity: number;
  failedQuantity: number;
  qualityApprovedQuantity: number;
  requiresQualityCheck: boolean;
  hasPendingQualityCheckFailure: boolean;
}

/**
 * The status a task returns to once unblocked, or moves to right after a
 * quantity update — derived from its quantities rather than stored as a
 * separate "status before blocking" column, matching this codebase's
 * established "recalculate, don't duplicate" convention.
 */
export function deriveTaskWorkingStatus(
  input: DeriveTaskWorkingStatusInput,
): "QUEUED" | "PARTIALLY_COMPLETE" | "AWAITING_QUALITY_CHECK" {
  const attempted = input.completedQuantity + input.failedQuantity;
  if (attempted < input.requiredQuantity) {
    return attempted > 0 ? "PARTIALLY_COMPLETE" : "QUEUED";
  }
  // Every required unit has been attempted (produced or failed).
  if (input.requiresQualityCheck && input.qualityApprovedQuantity < input.completedQuantity) {
    return "AWAITING_QUALITY_CHECK";
  }
  return input.hasPendingQualityCheckFailure ? "PARTIALLY_COMPLETE" : "AWAITING_QUALITY_CHECK";
}

export interface TaskCompletionEligibilityInput {
  status: ProductionTaskStatus;
  requiredQuantity: number;
  completedQuantity: number;
  failedQuantity: number;
  qualityApprovedQuantity: number;
  requiresQualityCheck: boolean;
  hasOpenBlockingIssue: boolean;
}

/** Can this task be marked COMPLETE right now? */
export function evaluateTaskCompletionEligibility(
  input: TaskCompletionEligibilityInput,
): TaskTransitionResult {
  if (isTerminalTaskStatus(input.status)) {
    return { allowed: false, reason: "This task has already reached a terminal status." };
  }
  if (input.hasOpenBlockingIssue) {
    return {
      allowed: false,
      reason: "This task has an unresolved blocking issue and can't be completed yet.",
    };
  }
  const attempted = input.completedQuantity + input.failedQuantity;
  if (attempted < input.requiredQuantity) {
    return {
      allowed: false,
      reason: `${input.requiredQuantity - attempted} unit(s) still need to be produced or recorded as failed.`,
    };
  }
  if (input.requiresQualityCheck && input.qualityApprovedQuantity < input.completedQuantity) {
    return {
      allowed: false,
      reason: "All produced units must pass quality check before this task can be completed.",
    };
  }
  return { allowed: true };
}
