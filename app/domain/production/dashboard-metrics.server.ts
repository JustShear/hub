import { db } from "~/lib/db.server";

// Real counts only — no invented targets/percentages, per the milestone's
// own "no fake targets" instruction. Every number here is a direct,
// bounded count against the current day/active-job set, safe to compute on
// every dashboard load.
export interface ProductionDashboardMetrics {
  queuedCount: number;
  inProgressCount: number;
  overdueCount: number;
  blockedCount: number;
  awaitingQualityCheckCount: number;
  completedTodayCount: number;
  remainingQuantity: number;
}

export async function getProductionDashboardMetrics(
  shopId: string,
): Promise<ProductionDashboardMetrics> {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const [
    queuedCount,
    inProgressCount,
    overdueCount,
    blockedCount,
    awaitingQualityCheckCount,
    completedTodayCount,
    activeTasks,
  ] = await Promise.all([
    db.productionJob.count({ where: { shopId, status: "QUEUED" } }),
    db.productionJob.count({ where: { shopId, status: "IN_PROGRESS" } }),
    db.productionJob.count({
      where: { shopId, dueDate: { lt: now }, status: { notIn: ["COMPLETE", "CANCELLED"] } },
    }),
    db.productionJob.count({ where: { shopId, status: "BLOCKED" } }),
    db.productionJob.count({ where: { shopId, status: "AWAITING_QUALITY_CHECK" } }),
    db.productionJob.count({
      where: { shopId, status: "COMPLETE", completedAt: { gte: startOfToday } },
    }),
    db.productionTask.findMany({
      where: { productionJob: { shopId }, status: { notIn: ["COMPLETE", "CANCELLED"] } },
      select: { requiredQuantity: true, completedQuantity: true, failedQuantity: true },
    }),
  ]);

  const remainingQuantity = activeTasks.reduce(
    (sum, t) => sum + Math.max(0, t.requiredQuantity - t.completedQuantity - t.failedQuantity),
    0,
  );

  return {
    queuedCount,
    inProgressCount,
    overdueCount,
    blockedCount,
    awaitingQualityCheckCount,
    completedTodayCount,
    remainingQuantity,
  };
}
