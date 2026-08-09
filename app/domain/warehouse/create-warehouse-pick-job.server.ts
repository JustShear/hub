import { ActorType, type Prisma, type PrismaClient } from "@prisma/client";

type TxClient = Prisma.TransactionClient | PrismaClient;

export interface CreateWarehousePickJobForOrderInput {
  shopId: string;
  orderId: string;
  actorStaffId: string | null;
}

/**
 * The one place warehouse pick jobs are created — called from two trigger
 * points, both firing off the order gaining the real "Exported for Print"
 * Shopify tag: a manual drag on the Kanban board
 * (move-order-workflow-status.server.ts) and a regular Shopify sync
 * (import-order.server.ts's wasExportedForPrintJustNow). Idempotent via a
 * plain existence check against WarehousePickJob's own
 * @@unique([orderId]) constraint, so it's safe to call from both triggers
 * (or a retry of either) without risk of duplicates. Creates one
 * WarehousePickItem per ShopifyOrderLine on the order, decorated or not —
 * a blank garment still has to be physically gathered.
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
