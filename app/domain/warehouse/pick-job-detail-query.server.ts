import { db } from "~/lib/db.server";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";

export async function loadWarehousePickJobDetail(params: { shopId: string; jobId: string }) {
  const job = await db.warehousePickJob.findFirst({
    where: { id: params.jobId, shopId: params.shopId },
    include: {
      order: { select: { id: true, orderNumber: true, customerName: true, isPreorder: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: { issues: { orderBy: { createdAt: "desc" } } },
      },
      issues: { where: { warehousePickItemId: null }, orderBy: { createdAt: "desc" } },
      notes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!job) return null;

  const activity = await db.activityEvent.findMany({
    where: {
      orderId: job.orderId,
      OR: [
        { entityType: "WarehousePickJob", entityId: job.id },
        { entityType: "WarehousePickItem", entityId: { in: job.items.map((i) => i.id) } },
        { entityType: "WarehouseIssue" },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const staffIds = [
    job.assignedStaffId,
    job.handedOverByStaffId,
    job.cancelledByStaffId,
    ...job.items.flatMap((i) => i.issues.map((issue) => issue.createdByStaffId)),
    ...job.items.flatMap((i) => i.issues.map((issue) => issue.resolvedByStaffId)),
    ...job.issues.map((i) => i.createdByStaffId),
    ...job.issues.map((i) => i.resolvedByStaffId),
    ...job.notes.map((n) => n.authorStaffId),
    ...activity.map((a) => a.actorStaffId),
  ];
  const staffNames = await resolveStaffNames(staffIds);

  return {
    job,
    activity,
    staffNames: Object.fromEntries(staffNames),
  };
}

export type WarehousePickJobDetail = NonNullable<
  Awaited<ReturnType<typeof loadWarehousePickJobDetail>>
>;
