import type { WarehouseIssueType } from "@prisma/client";
import { db } from "~/lib/db.server";

// Basic warehouse-picking reporting (Milestone 16) — bounded, date-range-
// filtered queries only, mirrors production/report.server.ts's own shape
// and "real counts only, no invented targets" discipline exactly.

export interface WarehouseReportByIssueType {
  issueType: WarehouseIssueType;
  count: number;
}

export interface WarehouseReport {
  from: string;
  to: string;
  jobsHandedOver: number;
  averageTimeToHandoverDays: number | null;
  itemsPicked: number;
  itemsShort: number;
  shortRatePercent: number | null;
  byIssueType: WarehouseReportByIssueType[];
  currentQueuedJobCount: number;
  currentInProgressJobCount: number;
}

export async function getWarehouseReport(params: {
  shopId: string;
  from: Date;
  to: Date;
}): Promise<WarehouseReport> {
  const { shopId, from, to } = params;

  const [
    handedOverJobs,
    itemCounts,
    issuesByType,
    currentQueuedJobCount,
    currentInProgressJobCount,
  ] = await Promise.all([
    db.warehousePickJob.findMany({
      where: { shopId, status: "HANDED_OVER", handedOverAt: { gte: from, lte: to } },
      select: { createdAt: true, handedOverAt: true },
    }),
    db.warehousePickItem.groupBy({
      by: ["status"],
      where: {
        warehousePickJob: { shopId },
        createdAt: { gte: from, lte: to },
        status: { in: ["PICKED", "SHORT"] },
      },
      _count: { _all: true },
    }),
    db.warehouseIssue.groupBy({
      by: ["issueType"],
      where: { warehousePickJob: { shopId }, createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    }),
    db.warehousePickJob.count({ where: { shopId, status: "QUEUED" } }),
    db.warehousePickJob.count({ where: { shopId, status: "IN_PROGRESS" } }),
  ]);

  const jobsHandedOver = handedOverJobs.length;
  const averageTimeToHandoverDays =
    jobsHandedOver === 0
      ? null
      : Math.round(
          (handedOverJobs.reduce(
            (sum, j) => sum + ((j.handedOverAt?.getTime() ?? 0) - j.createdAt.getTime()),
            0,
          ) /
            jobsHandedOver /
            86_400_000) *
            10,
        ) / 10;

  const itemsPicked = itemCounts.find((c) => c.status === "PICKED")?._count._all ?? 0;
  const itemsShort = itemCounts.find((c) => c.status === "SHORT")?._count._all ?? 0;
  const totalItems = itemsPicked + itemsShort;
  const shortRatePercent =
    totalItems === 0 ? null : Math.round((itemsShort / totalItems) * 1000) / 10;

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    jobsHandedOver,
    averageTimeToHandoverDays,
    itemsPicked,
    itemsShort,
    shortRatePercent,
    byIssueType: issuesByType.map((g) => ({ issueType: g.issueType, count: g._count._all })),
    currentQueuedJobCount,
    currentInProgressJobCount,
  };
}
