import { db } from "~/lib/db.server";

// Real counts only — no invented targets/percentages, same convention as
// production's dashboard-metrics.server.ts.
export interface WarehouseDashboardMetrics {
  queuedCount: number;
  inProgressCount: number;
  handedOverTodayCount: number;
  withShortageCount: number;
}

export async function getWarehouseDashboardMetrics(
  shopId: string,
): Promise<WarehouseDashboardMetrics> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [queuedCount, inProgressCount, handedOverTodayCount, withShortageCount] = await Promise.all(
    [
      db.warehousePickJob.count({ where: { shopId, status: "QUEUED" } }),
      db.warehousePickJob.count({ where: { shopId, status: "IN_PROGRESS" } }),
      db.warehousePickJob.count({
        where: { shopId, status: "HANDED_OVER", handedOverAt: { gte: startOfToday } },
      }),
      db.warehousePickJob.count({
        where: { shopId, status: { notIn: ["CANCELLED"] }, items: { some: { status: "SHORT" } } },
      }),
    ],
  );

  return { queuedCount, inProgressCount, handedOverTodayCount, withShortageCount };
}
