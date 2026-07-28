import { IntegrationFailureStatus, type IntegrationType, type Severity } from "@prisma/client";
import { db } from "~/lib/db.server";

// Exported so any other module that needs to count/query "unresolved"
// failures (e.g. the app shell's issue indicator) shares this exact
// definition rather than redefining what "open" means.
export const OPEN_STATUSES: IntegrationFailureStatus[] = [
  IntegrationFailureStatus.NEW,
  IntegrationFailureStatus.RETRYING,
  IntegrationFailureStatus.NEEDS_ATTENTION,
  IntegrationFailureStatus.ASSIGNED,
];

const MAX_AUTOMATIC_ATTEMPTS = 8;
const BASE_RETRY_DELAY_MS = 60_000; // 1 minute
const MAX_RETRY_DELAY_MS = 60 * 60_000; // 1 hour

// Exported separately so backoff timing is unit-testable without touching
// the database. attemptCount is the count *after* this failed attempt.
export function computeNextRetryDelayMs(attemptCount: number): number {
  const delay = BASE_RETRY_DELAY_MS * 2 ** (attemptCount - 1);
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

export interface RecordFailureInput {
  shopId: string;
  integration: IntegrationType;
  action: string;
  relatedOrderId?: string;
  summary: string;
  /** Already sanitised by the caller — never a raw error object, never a token. */
  technicalDetail?: string;
  severity: Severity;
  /** false for things like an invalid webhook signature — never scheduled for retry. */
  retryable: boolean;
}

// Never throws — a failure while recording a failure must not itself take
// down the caller. Upserts by (shop, integration, action, relatedOrderId) so
// repeated failures for the same thing accumulate attempts on one row
// instead of spawning duplicates.
export async function recordIntegrationFailure(input: RecordFailureInput) {
  const existing = await db.integrationFailure.findFirst({
    where: {
      shopId: input.shopId,
      integration: input.integration,
      action: input.action,
      relatedOrderId: input.relatedOrderId ?? null,
      status: { in: OPEN_STATUSES },
    },
    orderBy: { latestFailureAt: "desc" },
  });

  const now = new Date();

  if (existing) {
    const attemptCount = existing.attemptCount + 1;
    const exhausted = attemptCount >= MAX_AUTOMATIC_ATTEMPTS;
    const status =
      input.retryable && !exhausted
        ? IntegrationFailureStatus.RETRYING
        : IntegrationFailureStatus.NEEDS_ATTENTION;

    const [failure] = await db.$transaction([
      db.integrationFailure.update({
        where: { id: existing.id },
        data: {
          summary: input.summary,
          technicalDetail: input.technicalDetail,
          severity: input.severity,
          status,
          attemptCount,
          latestFailureAt: now,
          nextRetryAt:
            input.retryable && !exhausted
              ? new Date(now.getTime() + computeNextRetryDelayMs(attemptCount))
              : null,
        },
      }),
      db.integrationAttempt.create({
        data: { failureId: existing.id, succeeded: false, errorSummary: input.summary },
      }),
    ]);

    return failure;
  }

  const status = input.retryable
    ? IntegrationFailureStatus.RETRYING
    : IntegrationFailureStatus.NEEDS_ATTENTION;

  const failure = await db.integrationFailure.create({
    data: {
      shopId: input.shopId,
      integration: input.integration,
      action: input.action,
      relatedOrderId: input.relatedOrderId,
      summary: input.summary,
      technicalDetail: input.technicalDetail,
      severity: input.severity,
      status,
      attemptCount: 1,
      firstFailureAt: now,
      latestFailureAt: now,
      nextRetryAt: input.retryable ? new Date(now.getTime() + computeNextRetryDelayMs(1)) : null,
      attempts: { create: { succeeded: false, errorSummary: input.summary } },
    },
  });

  return failure;
}

// Marks any open failure for the same (shop, integration, action,
// relatedOrderId) resolved, and records the successful attempt against it —
// this is how "import failed and later succeeded" gets represented.
export async function recordIntegrationSuccessAfterFailure(
  shopId: string,
  integration: IntegrationType,
  action: string,
  relatedOrderId?: string,
) {
  const existing = await db.integrationFailure.findFirst({
    where: {
      shopId,
      integration,
      action,
      relatedOrderId: relatedOrderId ?? null,
      status: { in: OPEN_STATUSES },
    },
  });

  if (!existing) {
    return null;
  }

  const [failure] = await db.$transaction([
    db.integrationFailure.update({
      where: { id: existing.id },
      data: {
        status: IntegrationFailureStatus.RESOLVED,
        resolvedAt: new Date(),
        resolutionNote: "Automatically resolved: a subsequent retry succeeded.",
        nextRetryAt: null,
      },
    }),
    db.integrationAttempt.create({
      data: { failureId: existing.id, succeeded: true },
    }),
  ]);

  return failure;
}
