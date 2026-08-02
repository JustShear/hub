import type { Priority, WarehousePickJobStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";

const OPEN_ISSUE_STATUSES = ["OPEN", "INVESTIGATING", "WAITING"] as const;

// A light summary for the order drawer's Warehouse tab — not the full
// workstation view (that's the dedicated /warehouse/:jobId drawer).
// Read-only with a link out, same convention as
// production-job-order-query.server.ts.
export interface OrderDetailWarehousePickJob {
  id: string;
  status: WarehousePickJobStatus;
  priority: Priority;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  lineCount: number;
  pickedLineCount: number;
  hasShortItem: boolean;
  hasOpenIssue: boolean;
  createdAt: string;
  handedOverAt: string | null;
}

export async function loadWarehousePickJobForOrder(params: {
  shopId: string;
  orderId: string;
}): Promise<OrderDetailWarehousePickJob | null> {
  const job = await db.warehousePickJob.findFirst({
    where: { orderId: params.orderId, shopId: params.shopId },
    include: { items: { select: { status: true } } },
  });
  if (!job) return null;

  const staffNames = await resolveStaffNames([job.assignedStaffId]);
  const hasOpenIssue =
    (await db.warehouseIssue.count({
      where: { warehousePickJobId: job.id, status: { in: [...OPEN_ISSUE_STATUSES] } },
    })) > 0;

  return {
    id: job.id,
    status: job.status,
    priority: job.priority,
    assignedStaffId: job.assignedStaffId,
    assignedStaffName: job.assignedStaffId
      ? (staffNames.get(job.assignedStaffId) ?? "Unknown staff member")
      : null,
    lineCount: job.items.length,
    pickedLineCount: job.items.filter((i) => i.status === "PICKED" || i.status === "SHORT").length,
    hasShortItem: job.items.some((i) => i.status === "SHORT"),
    hasOpenIssue,
    createdAt: job.createdAt.toISOString(),
    handedOverAt: job.handedOverAt?.toISOString() ?? null,
  };
}
