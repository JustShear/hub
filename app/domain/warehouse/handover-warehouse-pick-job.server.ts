import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { evaluateHandoverEligibility } from "~/domain/warehouse/handover-eligibility";

export interface HandoverWarehousePickJobInput {
  shopId: string;
  warehousePickJobId: string;
  staffUserId: string;
}

export type HandoverWarehousePickJobResult =
  | { outcome: "handed_over" }
  | { outcome: "already_there" }
  | { outcome: "rejected"; reason: string };

/**
 * The one explicit terminal action for a WarehousePickJob. A short item
 * does not block this — a deliberate scope decision (short picks allow
 * partial handover with a flagged shortage) — but anything still PENDING/
 * IN_PROGRESS does. On success, finally makes OrderStatus.READY_TO_PACK
 * reachable (reserved since Milestone 06B) — the same "this milestone
 * finally reaches a long-reserved enum value" pattern as Milestone 12
 * reaching FULFILLED.
 */
export async function handoverWarehousePickJob(
  input: HandoverWarehousePickJobInput,
): Promise<HandoverWarehousePickJobResult> {
  const job = await db.warehousePickJob.findFirst({
    where: { id: input.warehousePickJobId, shopId: input.shopId },
    include: { items: { select: { status: true } } },
  });
  if (!job) {
    return { outcome: "rejected", reason: "Warehouse pick job not found." };
  }
  if (job.status === "HANDED_OVER") {
    return { outcome: "already_there" };
  }

  const eligibility = evaluateHandoverEligibility(job.status, job.items);
  if (!eligibility.eligible) {
    return {
      outcome: "rejected",
      reason: eligibility.reason ?? "This job isn't ready for handover.",
    };
  }

  const updateResult = await db.$transaction(async (tx) => {
    const result = await tx.warehousePickJob.updateMany({
      where: { id: job.id, status: { notIn: ["HANDED_OVER", "CANCELLED"] } },
      data: {
        status: "HANDED_OVER",
        handedOverAt: new Date(),
        handedOverByStaffId: input.staffUserId,
      },
    });
    if (result.count === 0) return { conflict: true as const };

    await tx.shopifyOrder.update({
      where: { id: job.orderId },
      data: {
        warehousePickSummary: "HANDED_OVER",
        workflowStatus: "READY_TO_PACK",
        workflowStatusChangedAt: new Date(),
      },
    });

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: job.orderId,
        entityType: "WarehousePickJob",
        entityId: job.id,
        eventType: "warehouse_pick_job_handed_over",
        summary: "Warehouse pick job handed over to packing",
        metadata: {
          shortItemCount: job.items.filter((i) => i.status === "SHORT").length,
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    return { conflict: false as const };
  });

  if (updateResult.conflict) {
    return { outcome: "already_there" };
  }

  return { outcome: "handed_over" };
}
