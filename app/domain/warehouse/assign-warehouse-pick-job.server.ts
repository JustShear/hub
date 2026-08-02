import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface AssignWarehousePickJobInput {
  shopId: string;
  warehousePickJobId: string;
  /** null clears the assignment — supports "unassigned" work explicitly. */
  targetStaffUserId: string | null;
  expectedVersion: number;
  staffUserId: string;
}

export type AssignWarehousePickJobResult =
  | { outcome: "assigned" }
  | { outcome: "already_there" }
  | { outcome: "rejected"; reason: string }
  | { outcome: "conflict"; reason: string; actualVersion: number };

const STALE_EDIT_MESSAGE =
  "This job's assignment changed since you last saw it. Refresh to see the current value.";

// Job-level assignment — deliberately separate from the order's own
// OrderAssignment(role: PACKING) slot (Milestone 07), the same "job-level
// vs order-level assignment are different things" precedent as production.
export async function assignWarehousePickJob(
  input: AssignWarehousePickJobInput,
): Promise<AssignWarehousePickJobResult> {
  const job = await db.warehousePickJob.findFirst({
    where: { id: input.warehousePickJobId, shopId: input.shopId },
  });
  if (!job) {
    return { outcome: "rejected", reason: "Warehouse pick job not found." };
  }
  if (job.status === "CANCELLED" || job.status === "HANDED_OVER") {
    return { outcome: "rejected", reason: "This pick job has reached a terminal status." };
  }

  if (job.assignedStaffId === input.targetStaffUserId) {
    return { outcome: "already_there" };
  }
  if (job.version !== input.expectedVersion) {
    return { outcome: "conflict", reason: STALE_EDIT_MESSAGE, actualVersion: job.version };
  }

  if (input.targetStaffUserId) {
    const targetStaff = await db.staffUser.findFirst({
      where: { id: input.targetStaffUserId, shopId: input.shopId, isActive: true },
    });
    if (!targetStaff) {
      return { outcome: "rejected", reason: "That staff member is not active or doesn't exist." };
    }
  }

  const transactionResult = await db.$transaction(async (tx) => {
    const updateResult = await tx.warehousePickJob.updateMany({
      where: { id: input.warehousePickJobId, version: input.expectedVersion },
      data: { assignedStaffId: input.targetStaffUserId, version: { increment: 1 } },
    });
    if (updateResult.count === 0) {
      return { conflict: true as const };
    }
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: job.orderId,
        entityType: "WarehousePickJob",
        entityId: job.id,
        eventType: "warehouse_pick_job_assigned",
        summary: "Warehouse pick job assignment changed",
        metadata: {
          previousStaffUserId: job.assignedStaffId,
          newStaffUserId: input.targetStaffUserId,
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return { conflict: false as const };
  });

  if (transactionResult.conflict) {
    const latest = await db.warehousePickJob.findUnique({
      where: { id: input.warehousePickJobId },
      select: { version: true },
    });
    return {
      outcome: "conflict",
      reason: STALE_EDIT_MESSAGE,
      actualVersion: latest?.version ?? input.expectedVersion,
    };
  }

  return { outcome: "assigned" };
}
