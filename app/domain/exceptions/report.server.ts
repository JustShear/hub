import type { ExceptionCaseCategory, ExceptionResolutionType } from "@prisma/client";
import { db } from "~/lib/db.server";

// Basic exception-case reporting (Milestone 16) — bounded, date-range-
// filtered queries only, mirrors production/report.server.ts's own shape
// and "real counts only, no invented targets" discipline exactly.

export interface ExceptionsReportByCategory {
  category: ExceptionCaseCategory;
  count: number;
}

export interface ExceptionsReportByResolutionType {
  resolutionType: ExceptionResolutionType;
  count: number;
}

export interface ExceptionsReport {
  from: string;
  to: string;
  casesOpened: number;
  casesResolved: number;
  averageTimeToResolutionDays: number | null;
  byCategory: ExceptionsReportByCategory[];
  byResolutionType: ExceptionsReportByResolutionType[];
  /** Sum of recorded CREDIT/REFUND amounts — a decision record, not a confirmation of actual payment (ADR-0010's record-only design). */
  totalRecordedCreditRefundAmount: string;
  currentOpenCaseCount: number;
}

export async function getExceptionsReport(params: {
  shopId: string;
  from: Date;
  to: Date;
}): Promise<ExceptionsReport> {
  const { shopId, from, to } = params;

  const [casesOpened, resolvedCases, byCategory, resolutionsInRange, currentOpenCaseCount] =
    await Promise.all([
      db.exceptionCase.count({ where: { shopId, createdAt: { gte: from, lte: to } } }),
      db.exceptionCase.findMany({
        where: { shopId, status: "RESOLVED", resolvedAt: { gte: from, lte: to } },
        select: { createdAt: true, resolvedAt: true },
      }),
      db.exceptionCase.groupBy({
        by: ["category"],
        where: { shopId, createdAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      db.exceptionCaseResolution.findMany({
        where: { exceptionCase: { shopId }, decidedAt: { gte: from, lte: to } },
        select: { resolutionType: true, amount: true },
      }),
      db.exceptionCase.count({ where: { shopId, status: { notIn: ["RESOLVED", "CANCELLED"] } } }),
    ]);

  const casesResolved = resolvedCases.length;
  const averageTimeToResolutionDays =
    casesResolved === 0
      ? null
      : Math.round(
          (resolvedCases.reduce(
            (sum, c) => sum + ((c.resolvedAt?.getTime() ?? 0) - c.createdAt.getTime()),
            0,
          ) /
            casesResolved /
            86_400_000) *
            10,
        ) / 10;

  const resolutionTypeCounts = new Map<ExceptionResolutionType, number>();
  let totalAmount = 0;
  for (const resolution of resolutionsInRange) {
    resolutionTypeCounts.set(
      resolution.resolutionType,
      (resolutionTypeCounts.get(resolution.resolutionType) ?? 0) + 1,
    );
    if (resolution.amount) {
      totalAmount += Number(resolution.amount);
    }
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    casesOpened,
    casesResolved,
    averageTimeToResolutionDays,
    byCategory: byCategory.map((g) => ({ category: g.category, count: g._count._all })),
    byResolutionType: [...resolutionTypeCounts.entries()].map(([resolutionType, count]) => ({
      resolutionType,
      count,
    })),
    totalRecordedCreditRefundAmount: totalAmount.toFixed(2),
    currentOpenCaseCount,
  };
}
