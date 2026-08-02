import { db } from "~/lib/db.server";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";

const OPEN_ISSUE_STATUSES: readonly string[] = ["OPEN", "INVESTIGATING", "WAITING"];

export async function loadProductionJobDetail(params: { shopId: string; jobId: string }) {
  const job = await db.productionJob.findFirst({
    where: { id: params.jobId, shopId: params.shopId },
    include: {
      order: { select: { id: true, orderNumber: true, customerName: true, isPreorder: true } },
      exportBatch: { select: { id: true, batchNumber: true, destination: true, exportedAt: true } },
      tasks: {
        orderBy: { createdAt: "asc" },
        include: {
          proofGroup: { select: { id: true, name: true } },
          productionArtwork: {
            select: {
              id: true,
              revisionNumber: true,
              originalFilename: true,
              mimeType: true,
              isPreviewable: true,
              decorationMethod: true,
              placement: true,
              width: true,
              height: true,
              sourceProofVersionId: true,
              sourceNoProofReasonSnapshot: true,
            },
          },
          qualityChecks: { orderBy: { createdAt: "desc" } },
          issues: { orderBy: { createdAt: "desc" } },
          notes: { orderBy: { createdAt: "desc" } },
        },
      },
      issues: { where: { productionTaskId: null }, orderBy: { createdAt: "desc" } },
      notes: { where: { productionTaskId: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!job) return null;

  const activity = await db.activityEvent.findMany({
    where: {
      orderId: job.orderId,
      OR: [
        { entityType: "ProductionJob", entityId: job.id },
        { entityType: "ProductionTask", entityId: { in: job.tasks.map((t) => t.id) } },
        { entityType: "ProductionIssue" },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const staffIds = [
    job.assignedStaffId,
    job.createdByStaffId,
    job.completedByStaffId,
    job.reopenedByStaffId,
    ...job.tasks.map((t) => t.assignedStaffId),
    ...job.tasks.map((t) => t.completedByStaffId),
    ...job.tasks.flatMap((t) => t.notes.map((n) => n.authorStaffId)),
    ...job.tasks.flatMap((t) => t.issues.map((i) => i.createdByStaffId)),
    ...job.tasks.flatMap((t) => t.qualityChecks.map((q) => q.checkedByStaffId)),
    ...job.notes.map((n) => n.authorStaffId),
    ...job.issues.map((i) => i.createdByStaffId),
    ...activity.map((a) => a.actorStaffId),
  ];
  const staffNames = await resolveStaffNames(staffIds);
  const openIssueTaskIds = new Set(
    job.tasks
      .filter((t) => t.issues.some((i) => i.isBlocking && OPEN_ISSUE_STATUSES.includes(i.status)))
      .map((t) => t.id),
  );

  return {
    job,
    activity,
    staffNames: Object.fromEntries(staffNames),
    openIssueTaskIds: [...openIssueTaskIds],
  };
}

export type ProductionJobDetail = NonNullable<Awaited<ReturnType<typeof loadProductionJobDetail>>>;
