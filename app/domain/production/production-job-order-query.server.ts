import type {
  DecorationMethod,
  Priority,
  ProductionIssueStatus,
  ProductionJobStatus,
} from "@prisma/client";
import { db } from "~/lib/db.server";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";

const OPEN_ISSUE_STATUSES: ProductionIssueStatus[] = ["OPEN", "INVESTIGATING", "WAITING"];

// A light summary for the order drawer's Production tab — not the full
// workstation view (that's the dedicated /production/:jobId drawer). Never
// duplicates task-level mutation UI here; this is read-only with a link out.
export interface OrderDetailProductionJob {
  id: string;
  jobNumber: number;
  decorationMethod: DecorationMethod;
  status: ProductionJobStatus;
  priority: Priority;
  dueDate: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  exportBatchNumber: number;
  taskCount: number;
  completedTaskCount: number;
  totalQuantity: number;
  completedQuantity: number;
  hasOpenIssue: boolean;
  createdAt: string;
  completedAt: string | null;
}

export async function loadProductionJobsForOrder(params: {
  shopId: string;
  orderId: string;
}): Promise<OrderDetailProductionJob[]> {
  const jobs = await db.productionJob.findMany({
    where: { orderId: params.orderId, shopId: params.shopId },
    orderBy: { jobNumber: "asc" },
    include: {
      exportBatch: { select: { batchNumber: true } },
      tasks: {
        where: { status: { not: "CANCELLED" } },
        select: { status: true, requiredQuantity: true, completedQuantity: true },
      },
    },
  });

  if (jobs.length === 0) return [];

  const staffNames = await resolveStaffNames(jobs.map((j) => j.assignedStaffId));
  const openIssueJobIds = new Set(
    (
      await db.productionIssue.findMany({
        where: {
          productionJobId: { in: jobs.map((j) => j.id) },
          status: { in: OPEN_ISSUE_STATUSES },
        },
        select: { productionJobId: true },
      })
    ).map((i) => i.productionJobId),
  );

  return jobs.map((job): OrderDetailProductionJob => {
    return {
      id: job.id,
      jobNumber: job.jobNumber,
      decorationMethod: job.decorationMethod,
      status: job.status,
      priority: job.priority,
      dueDate: job.dueDate?.toISOString() ?? null,
      assignedStaffId: job.assignedStaffId,
      assignedStaffName: job.assignedStaffId
        ? (staffNames.get(job.assignedStaffId) ?? "Unknown staff member")
        : null,
      exportBatchNumber: job.exportBatch.batchNumber,
      taskCount: job.tasks.length,
      completedTaskCount: job.tasks.filter((t) => t.status === "COMPLETE").length,
      totalQuantity: job.tasks.reduce((sum, t) => sum + t.requiredQuantity, 0),
      completedQuantity: job.tasks.reduce((sum, t) => sum + t.completedQuantity, 0),
      hasOpenIssue: openIssueJobIds.has(job.id),
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  });
}
