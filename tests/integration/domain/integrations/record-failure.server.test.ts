import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { IntegrationFailureStatus, IntegrationType, Severity } from "@prisma/client";
import { db } from "~/lib/db.server";
import {
  recordIntegrationFailure,
  recordIntegrationSuccessAfterFailure,
} from "~/domain/integrations/record-failure.server";

// Runs against the real local Postgres (docker-compose) — same requirement
// as the rest of the integration suite.
describe("recordIntegrationFailure (integration)", () => {
  const createdFailureIds: string[] = [];

  afterAll(async () => {
    if (createdFailureIds.length > 0) {
      await db.integrationAttempt.deleteMany({ where: { failureId: { in: createdFailureIds } } });
      await db.integrationFailure.deleteMany({ where: { id: { in: createdFailureIds } } });
    }
  });

  it("creates a new failure with one attempt on first occurrence", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const action = `test-action-${randomUUID()}`;

    const failure = await recordIntegrationFailure({
      shopId: shop.id,
      integration: IntegrationType.SHOPIFY_ORDER_IMPORT,
      action,
      summary: "GraphQL request failed",
      technicalDetail: "HTTP 500",
      severity: Severity.MEDIUM,
      retryable: true,
    });
    createdFailureIds.push(failure.id);

    expect(failure.attemptCount).toBe(1);
    expect(failure.status).toBe(IntegrationFailureStatus.RETRYING);
    expect(failure.nextRetryAt).not.toBeNull();

    const attempts = await db.integrationAttempt.findMany({ where: { failureId: failure.id } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.succeeded).toBe(false);
  });

  it("accumulates attempts on the same failure instead of creating duplicates", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const action = `test-action-${randomUUID()}`;

    const first = await recordIntegrationFailure({
      shopId: shop.id,
      integration: IntegrationType.SHOPIFY_ORDER_IMPORT,
      action,
      summary: "GraphQL request failed",
      severity: Severity.MEDIUM,
      retryable: true,
    });
    createdFailureIds.push(first.id);

    const second = await recordIntegrationFailure({
      shopId: shop.id,
      integration: IntegrationType.SHOPIFY_ORDER_IMPORT,
      action,
      summary: "GraphQL request failed again",
      severity: Severity.MEDIUM,
      retryable: true,
    });

    expect(second.id).toBe(first.id);
    expect(second.attemptCount).toBe(2);

    const allFailuresForAction = await db.integrationFailure.findMany({
      where: { shopId: shop.id, action },
    });
    expect(allFailuresForAction).toHaveLength(1);
  });

  it("marks a non-retryable failure NEEDS_ATTENTION with no scheduled retry", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const action = `test-action-${randomUUID()}`;

    const failure = await recordIntegrationFailure({
      shopId: shop.id,
      integration: IntegrationType.WEBHOOK,
      action,
      summary: "Invalid webhook signature",
      severity: Severity.HIGH,
      retryable: false,
    });
    createdFailureIds.push(failure.id);

    expect(failure.status).toBe(IntegrationFailureStatus.NEEDS_ATTENTION);
    expect(failure.nextRetryAt).toBeNull();
  });

  it("stops scheduling retries once the automatic attempt limit is reached", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const action = `test-action-${randomUUID()}`;

    let failure = await recordIntegrationFailure({
      shopId: shop.id,
      integration: IntegrationType.SHOPIFY_ORDER_IMPORT,
      action,
      summary: "Persistent failure",
      severity: Severity.MEDIUM,
      retryable: true,
    });
    createdFailureIds.push(failure.id);

    for (let i = 0; i < 8; i++) {
      failure = await recordIntegrationFailure({
        shopId: shop.id,
        integration: IntegrationType.SHOPIFY_ORDER_IMPORT,
        action,
        summary: "Persistent failure",
        severity: Severity.MEDIUM,
        retryable: true,
      });
    }

    expect(failure.attemptCount).toBeGreaterThanOrEqual(8);
    expect(failure.status).toBe(IntegrationFailureStatus.NEEDS_ATTENTION);
    expect(failure.nextRetryAt).toBeNull();
  });

  it("resolves an open failure and records a successful attempt when a retry succeeds", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const action = `test-action-${randomUUID()}`;

    const failure = await recordIntegrationFailure({
      shopId: shop.id,
      integration: IntegrationType.SHOPIFY_ORDER_IMPORT,
      action,
      summary: "Temporary failure",
      severity: Severity.MEDIUM,
      retryable: true,
    });
    createdFailureIds.push(failure.id);

    const resolved = await recordIntegrationSuccessAfterFailure(
      shop.id,
      IntegrationType.SHOPIFY_ORDER_IMPORT,
      action,
    );

    expect(resolved?.status).toBe(IntegrationFailureStatus.RESOLVED);

    const attempts = await db.integrationAttempt.findMany({
      where: { failureId: failure.id },
      orderBy: { attemptedAt: "asc" },
    });
    expect(attempts.some((attempt) => attempt.succeeded)).toBe(true);
  });

  it("does nothing when there's no open failure to resolve", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const result = await recordIntegrationSuccessAfterFailure(
      shop.id,
      IntegrationType.SHOPIFY_ORDER_IMPORT,
      `never-failed-${randomUUID()}`,
    );
    expect(result).toBeNull();
  });
});
