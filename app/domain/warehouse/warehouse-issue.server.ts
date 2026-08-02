import { ActorType, type Severity, type WarehouseIssueType } from "@prisma/client";
import { db } from "~/lib/db.server";

const OPEN_ISSUE_STATUSES = ["OPEN", "INVESTIGATING", "WAITING"] as const;

export interface CreateWarehouseIssueInput {
  shopId: string;
  warehousePickJobId: string;
  warehousePickItemId: string | null;
  issueType: WarehouseIssueType;
  severity: Severity;
  description: string;
  isBlocking: boolean;
  staffUserId: string;
}

export type CreateWarehouseIssueResult =
  { outcome: "created"; issueId: string } | { outcome: "rejected"; reason: string };

/**
 * A blocking issue doesn't move any stored status (WarehousePickItemStatus
 * has no BLOCKED value — simpler than production's model) — instead,
 * recordPickQuantity itself checks for an open blocking issue on the item
 * and rejects while one exists. Not blocking simply records the issue.
 */
export async function createWarehouseIssue(
  input: CreateWarehouseIssueInput,
): Promise<CreateWarehouseIssueResult> {
  const trimmedDescription = input.description.trim();
  if (!trimmedDescription) {
    return { outcome: "rejected", reason: "A description is required to report an issue." };
  }

  const job = await db.warehousePickJob.findFirst({
    where: { id: input.warehousePickJobId, shopId: input.shopId },
  });
  if (!job) {
    return { outcome: "rejected", reason: "Warehouse pick job not found." };
  }

  if (input.warehousePickItemId) {
    const item = await db.warehousePickItem.findFirst({
      where: { id: input.warehousePickItemId, warehousePickJobId: input.warehousePickJobId },
    });
    if (!item) {
      return { outcome: "rejected", reason: "Warehouse pick item not found on this job." };
    }
  }

  const created = await db.warehouseIssue.create({
    data: {
      shopId: input.shopId,
      orderId: job.orderId,
      warehousePickJobId: job.id,
      warehousePickItemId: input.warehousePickItemId,
      issueType: input.issueType,
      severity: input.severity,
      description: trimmedDescription,
      isBlocking: input.isBlocking,
      createdByStaffId: input.staffUserId,
    },
  });

  await db.activityEvent.create({
    data: {
      shopId: input.shopId,
      orderId: job.orderId,
      entityType: "WarehouseIssue",
      entityId: created.id,
      eventType: "warehouse_issue_created",
      summary: `Warehouse issue reported${input.isBlocking ? " (blocking)" : ""}: ${trimmedDescription}`,
      metadata: {
        issueType: input.issueType,
        severity: input.severity,
        isBlocking: input.isBlocking,
      },
      actorStaffId: input.staffUserId,
      actorType: ActorType.STAFF,
    },
  });

  // Only a blocking issue pages the assigned staff member — a non-blocking
  // issue is just a record, not something that needs their attention now.
  if (input.isBlocking && job.assignedStaffId && job.assignedStaffId !== input.staffUserId) {
    await db.notification.create({
      data: {
        staffUserId: job.assignedStaffId,
        type: "warehouse_issue_blocking",
        title: "Blocking warehouse issue reported",
        body: trimmedDescription,
        relatedEntityType: "WarehousePickJob",
        relatedEntityId: job.id,
      },
    });
  }

  return { outcome: "created", issueId: created.id };
}

export interface ResolveWarehouseIssueInput {
  shopId: string;
  warehouseIssueId: string;
  resolutionNote: string;
  cancel: boolean;
  staffUserId: string;
}

export type ResolveWarehouseIssueResult =
  { outcome: "resolved" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

export async function resolveWarehouseIssue(
  input: ResolveWarehouseIssueInput,
): Promise<ResolveWarehouseIssueResult> {
  const issue = await db.warehouseIssue.findFirst({
    where: { id: input.warehouseIssueId, shopId: input.shopId },
  });
  if (!issue) {
    return { outcome: "rejected", reason: "Warehouse issue not found." };
  }
  if (issue.status === "RESOLVED" || issue.status === "CANCELLED") {
    return { outcome: "already_there" };
  }

  const trimmedNote = input.resolutionNote.trim();
  if (!input.cancel && !trimmedNote) {
    return { outcome: "rejected", reason: "A resolution note is required to resolve an issue." };
  }

  const nextStatus = input.cancel ? "CANCELLED" : "RESOLVED";

  await db.$transaction(async (tx) => {
    const updateResult = await tx.warehouseIssue.updateMany({
      where: { id: issue.id, status: { in: [...OPEN_ISSUE_STATUSES] } },
      data: {
        status: nextStatus,
        resolvedAt: new Date(),
        resolvedByStaffId: input.staffUserId,
        resolutionNote: trimmedNote || null,
      },
    });
    if (updateResult.count === 0) return;

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: issue.orderId,
        entityType: "WarehouseIssue",
        entityId: issue.id,
        eventType: input.cancel ? "warehouse_issue_cancelled" : "warehouse_issue_resolved",
        summary: input.cancel
          ? "Warehouse issue cancelled"
          : `Warehouse issue resolved: ${trimmedNote}`,
        metadata: { resolutionNote: trimmedNote || null },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
  });

  return { outcome: "resolved" };
}
