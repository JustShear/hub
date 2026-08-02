import { db } from "~/lib/db.server";

// Real counts only — no invented targets/percentages, same convention as
// production's/warehouse's own dashboard-metrics.server.ts.
export interface ExceptionsDashboardMetrics {
  openCount: number;
  investigatingCount: number;
  awaitingCustomerCount: number;
  resolvedTodayCount: number;
}

export async function getExceptionsDashboardMetrics(
  shopId: string,
): Promise<ExceptionsDashboardMetrics> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [openCount, investigatingCount, awaitingCustomerCount, resolvedTodayCount] =
    await Promise.all([
      db.exceptionCase.count({ where: { shopId, status: "OPEN" } }),
      db.exceptionCase.count({ where: { shopId, status: "INVESTIGATING" } }),
      db.exceptionCase.count({ where: { shopId, status: "AWAITING_CUSTOMER" } }),
      db.exceptionCase.count({
        where: { shopId, status: "RESOLVED", resolvedAt: { gte: startOfToday } },
      }),
    ]);

  return { openCount, investigatingCount, awaitingCustomerCount, resolvedTodayCount };
}
