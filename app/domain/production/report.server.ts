import type { DecorationMethod } from "@prisma/client";
import { db } from "~/lib/db.server";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";

// Basic production reporting — bounded, date-range-filtered queries only,
// no invented precision on incomplete historical data. Quantity totals come
// from the append-only ProductionQuantityUpdate log (the real historical
// record), not from tasks' current running totals, which rework can
// legitimately move around after the fact.

export interface ProductionReportByDecorationMethod {
  decorationMethod: DecorationMethod;
  jobsCreated: number;
}

export interface ProductionReportStaffCount {
  staffUserId: string;
  staffUserName: string;
  activeJobCount: number;
}

export interface ProductionReport {
  from: string;
  to: string;
  jobsCreated: number;
  jobsCompleted: number;
  averageLeadTimeDays: number | null;
  byDecorationMethod: ProductionReportByDecorationMethod[];
  quantityProduced: number;
  quantityFailed: number;
  quantityReworked: number;
  currentBlockedJobCount: number;
  currentOverdueJobCount: number;
  staffAssignmentCounts: ProductionReportStaffCount[];
}

export async function getProductionReport(params: {
  shopId: string;
  from: Date;
  to: Date;
}): Promise<ProductionReport> {
  const { shopId, from, to } = params;
  const now = new Date();

  const [
    jobsCreated,
    completedJobs,
    jobsByDecorationMethod,
    quantityUpdates,
    currentBlockedJobCount,
    currentOverdueJobCount,
    activeJobAssignments,
  ] = await Promise.all([
    db.productionJob.count({ where: { shopId, createdAt: { gte: from, lte: to } } }),
    db.productionJob.findMany({
      where: { shopId, status: "COMPLETE", completedAt: { gte: from, lte: to } },
      select: { createdAt: true, completedAt: true },
    }),
    db.productionJob.groupBy({
      by: ["decorationMethod"],
      where: { shopId, createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    }),
    db.productionQuantityUpdate.findMany({
      where: { productionTask: { productionJob: { shopId } }, createdAt: { gte: from, lte: to } },
      select: { newlyProducedQuantity: true, newlyFailedQuantity: true, reworkedQuantity: true },
    }),
    db.productionJob.count({ where: { shopId, status: "BLOCKED" } }),
    db.productionJob.count({
      where: { shopId, dueDate: { lt: now }, status: { notIn: ["COMPLETE", "CANCELLED"] } },
    }),
    db.productionJob.findMany({
      where: {
        shopId,
        status: { notIn: ["COMPLETE", "CANCELLED"] },
        assignedStaffId: { not: null },
      },
      select: { assignedStaffId: true },
    }),
  ]);

  const jobsCompleted = completedJobs.length;
  const averageLeadTimeDays =
    jobsCompleted === 0
      ? null
      : Math.round(
          (completedJobs.reduce(
            (sum, j) => sum + ((j.completedAt?.getTime() ?? 0) - j.createdAt.getTime()),
            0,
          ) /
            jobsCompleted /
            86_400_000) *
            10,
        ) / 10;

  const quantityProduced = quantityUpdates.reduce((sum, u) => sum + u.newlyProducedQuantity, 0);
  const quantityFailed = quantityUpdates.reduce((sum, u) => sum + u.newlyFailedQuantity, 0);
  const quantityReworked = quantityUpdates.reduce((sum, u) => sum + u.reworkedQuantity, 0);

  const staffCounts = new Map<string, number>();
  for (const job of activeJobAssignments) {
    if (!job.assignedStaffId) continue;
    staffCounts.set(job.assignedStaffId, (staffCounts.get(job.assignedStaffId) ?? 0) + 1);
  }
  const staffNames = await resolveStaffNames([...staffCounts.keys()]);
  const staffAssignmentCounts = [...staffCounts.entries()]
    .map(([staffUserId, activeJobCount]) => ({
      staffUserId,
      staffUserName: staffNames.get(staffUserId) ?? "Unknown staff member",
      activeJobCount,
    }))
    .sort((a, b) => b.activeJobCount - a.activeJobCount);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    jobsCreated,
    jobsCompleted,
    averageLeadTimeDays,
    byDecorationMethod: jobsByDecorationMethod.map((g) => ({
      decorationMethod: g.decorationMethod,
      jobsCreated: g._count._all,
    })),
    quantityProduced,
    quantityFailed,
    quantityReworked,
    currentBlockedJobCount,
    currentOverdueJobCount,
    staffAssignmentCounts,
  };
}
