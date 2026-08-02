import { ActorType, type Prisma, type PrismaClient } from "@prisma/client";

type TxClient = Prisma.TransactionClient | PrismaClient;

export interface CreateWarehousePickJobForOrderInput {
  shopId: string;
  orderId: string;
  actorStaffId: string | null;
}

/**
 * The one place warehouse pick jobs are created — called by
 * recalculateOrderProductionSummary the moment productionSummary
 * transitions to COMPLETE, in the same transaction (pure DB writes, no
 * external I/O, so unlike Milestone 12's Starshipit call there's no reason
 * to keep this out of the transaction — doing so gives stronger
 * consistency, not weaker). Idempotent via a plain existence check against
 * WarehousePickJob's own @@unique([orderId]) constraint — safe because this
 * always runs inside the same transaction as the summary flip, so there's
 * no concurrent-race window to worry about. Creates one WarehousePickItem
 * per ShopifyOrderLine on the order, decorated or not — a blank garment
 * still has to be physically gathered.
 */
export async function createWarehousePickJobForOrder(
  tx: TxClient,
  input: CreateWarehousePickJobForOrderInput,
): Promise<void> {
  const existing = await tx.warehousePickJob.findUnique({ where: { orderId: input.orderId } });
  if (existing) return;

  const lines = await tx.shopifyOrderLine.findMany({
    where: { orderId: input.orderId },
    select: { id: true, sku: true, productTitle: true, quantity: true },
  });
  if (lines.length === 0) return;

  const job = await tx.warehousePickJob.create({
    data: {
      shopId: input.shopId,
      orderId: input.orderId,
      items: {
        create: lines.map((line) => ({
          orderLineId: line.id,
          sku: line.sku,
          productTitle: line.productTitle,
          requiredQuantity: line.quantity,
        })),
      },
    },
  });

  await tx.activityEvent.create({
    data: {
      shopId: input.shopId,
      orderId: input.orderId,
      entityType: "WarehousePickJob",
      entityId: job.id,
      eventType: "warehouse_pick_job_created",
      summary: `Warehouse pick job created (${lines.length} line(s)) now that production is complete`,
      metadata: { lineCount: lines.length },
      actorStaffId: input.actorStaffId,
      actorType: input.actorStaffId ? ActorType.STAFF : ActorType.SYSTEM,
    },
  });
}
