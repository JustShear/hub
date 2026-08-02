import { afterAll, describe, expect, it } from "vitest";
import { createExceptionCase } from "~/domain/exceptions/create-exception-case.server";
import { resolveExceptionCase } from "~/domain/exceptions/resolve-exception-case.server";
import { getExceptionsReport } from "~/domain/exceptions/report.server";
import { createExceptionTestTracker } from "./helpers";

describe("getExceptionsReport (integration)", () => {
  const tracker = createExceptionTestTracker();
  afterAll(tracker.cleanup);

  it("counts opened/resolved cases, buckets by category, and sums recorded credit/refund amounts", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();

    const created = await createExceptionCase({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: null,
      category: "CUSTOMER_RETURN",
      initiatedBy: "CUSTOMER",
      summary: "Report test case",
      customerNote: null,
      staffUserId: staffUser.id,
    });
    if (created.outcome !== "created") throw new Error("setup failed");
    tracker.trackExceptionCase(created.exceptionCaseId);

    const resolved = await resolveExceptionCase({
      shopId: order.shopId,
      exceptionCaseId: created.exceptionCaseId,
      resolutionType: "REFUND",
      reason: "Report test refund",
      amount: 25.5,
      currencyCode: "AUD",
      proofGroupId: null,
      staffUserId: staffUser.id,
    });
    expect(resolved.outcome).toBe("resolved");

    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 60_000);
    const report = await getExceptionsReport({ shopId: order.shopId, from, to });

    expect(report.casesOpened).toBeGreaterThanOrEqual(1);
    expect(report.casesResolved).toBeGreaterThanOrEqual(1);
    expect(report.byCategory.some((c) => c.category === "CUSTOMER_RETURN")).toBe(true);
    expect(report.byResolutionType.some((r) => r.resolutionType === "REFUND")).toBe(true);
    expect(Number(report.totalRecordedCreditRefundAmount)).toBeGreaterThanOrEqual(25.5);
  });

  it("returns null average-resolution-time when nothing resolved in the date range", async () => {
    const order = await tracker.createOrder();
    const from = new Date("2020-01-01");
    const to = new Date("2020-01-02");
    const report = await getExceptionsReport({ shopId: order.shopId, from, to });

    expect(report.casesResolved).toBe(0);
    expect(report.averageTimeToResolutionDays).toBeNull();
  });
});
