// Development-only fixture generator for manually verifying warehouse
// picking (Milestone 13). Creates its own small, self-contained orders and
// calls createWarehousePickJobForOrder directly — the same function the
// real "Exported for Print" tag-gain triggers call
// (move-order-workflow-status.server.ts / import-order.server.ts) — rather
// than driving any UI/tag flow, since these fixtures only need a genuine
// WarehousePickJob to exist as their starting point. Entirely synthetic
// data. Safe to re-run: each order is looked up by its orderNumber first
// and reused rather than recreated.
//
// Usage:
//   npm run db:seed:warehouse-demo

import { randomUUID } from "node:crypto";
import { db } from "../app/lib/db.server";
import { hashPassword } from "../app/auth/password.server";
import { createWarehousePickJobForOrder } from "../app/domain/warehouse/create-warehouse-pick-job.server";
import { assignWarehousePickJob } from "../app/domain/warehouse/assign-warehouse-pick-job.server";
import { recordPickQuantity } from "../app/domain/warehouse/record-pick-quantity.server";
import { markPickItemShort } from "../app/domain/warehouse/mark-pick-item-short.server";
import { handoverWarehousePickJob } from "../app/domain/warehouse/handover-warehouse-pick-job.server";

async function main() {
  const shop = await db.shop.findFirstOrThrow();

  const packingStaffRole = await db.role.findUniqueOrThrow({
    where: { shopId_name: { shopId: shop.id, name: "PACKING_STAFF" } },
  });
  const packingStaff = await db.staffUser.upsert({
    where: { shopId_email: { shopId: shop.id, email: "demo.packing@justshear.example" } },
    update: {},
    create: {
      shopId: shop.id,
      email: "demo.packing@justshear.example",
      name: "Jamie Ruiz",
      passwordHash: await hashPassword(randomUUID()),
    },
  });
  await db.staffRole.upsert({
    where: { staffUserId_roleId: { staffUserId: packingStaff.id, roleId: packingStaffRole.id } },
    update: {},
    create: { staffUserId: packingStaff.id, roleId: packingStaffRole.id },
  });

  async function createOrderWithPickJob(params: {
    orderNumber: string;
    productTitle: string;
    sku: string;
    quantity: number;
  }) {
    const existing = await db.shopifyOrder.findFirst({
      where: { shopId: shop.id, orderNumber: params.orderNumber },
      include: { lines: true },
    });
    if (existing) {
      const existingLine = existing.lines[0];
      if (!existingLine) {
        throw new Error(`Existing order "${params.orderNumber}" has no lines.`);
      }
      const pickJob = await db.warehousePickJob.findUnique({ where: { orderId: existing.id } });
      return { order: existing, line: existingLine, pickJob };
    }

    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: params.orderNumber,
        shopifyCreatedAt: new Date(),
        tags: ["Exported for Print"],
        rawPayload: {},
        customerEmail: `customer-${randomUUID()}@example.test`,
        customerName: "Warehouse Demo Customer",
        shippingMethod: "Standard",
        currencyCode: "AUD",
      },
    });
    const line = await db.shopifyOrderLine.create({
      data: {
        orderId: order.id,
        shopifyLineGid: `gid://shopify/LineItem/${randomUUID()}`,
        productTitle: params.productTitle,
        sku: params.sku,
        quantity: params.quantity,
      },
    });

    await db.$transaction((tx) =>
      createWarehousePickJobForOrder(tx, {
        shopId: shop.id,
        orderId: order.id,
        actorStaffId: packingStaff.id,
      }),
    );

    const pickJob = await db.warehousePickJob.findUnique({ where: { orderId: order.id } });
    return { order, line, pickJob };
  }

  // Scenario A — freshly queued, nothing picked yet.
  await createOrderWithPickJob({
    orderNumber: "#9101",
    productTitle: "Classic Hoodie",
    sku: "HOOD-BLK-M",
    quantity: 10,
  });

  // Scenario B — in progress, a partial pick recorded.
  const inProgress = await createOrderWithPickJob({
    orderNumber: "#9102",
    productTitle: "Varsity Jacket",
    sku: "VARS-NVY-L",
    quantity: 8,
  });
  if (inProgress.pickJob) {
    const item = await db.warehousePickItem.findFirstOrThrow({
      where: { warehousePickJobId: inProgress.pickJob.id },
    });
    await assignWarehousePickJob({
      shopId: shop.id,
      warehousePickJobId: inProgress.pickJob.id,
      targetStaffUserId: packingStaff.id,
      expectedVersion: inProgress.pickJob.version,
      staffUserId: packingStaff.id,
    });
    await recordPickQuantity({
      shopId: shop.id,
      warehousePickItemId: item.id,
      newlyPickedQuantity: Math.max(1, Math.floor(item.requiredQuantity / 2)),
      idempotencyKey: "seed-warehouse-demo-partial",
      staffUserId: packingStaff.id,
    });
  }

  // Scenario C — a short line (auto-creates a non-blocking WarehouseIssue),
  // not yet handed over.
  const short = await createOrderWithPickJob({
    orderNumber: "#9103",
    productTitle: "Beanie",
    sku: "BEAN-GRY-OS",
    quantity: 20,
  });
  if (short.pickJob) {
    const item = await db.warehousePickItem.findFirstOrThrow({
      where: { warehousePickJobId: short.pickJob.id },
    });
    await recordPickQuantity({
      shopId: shop.id,
      warehousePickItemId: item.id,
      newlyPickedQuantity: Math.max(1, item.requiredQuantity - 5),
      idempotencyKey: "seed-warehouse-demo-short-1",
      staffUserId: packingStaff.id,
    });
    await markPickItemShort({
      shopId: shop.id,
      warehousePickItemId: item.id,
      reason: "Only partial stock on the shelf — remainder on order from supplier.",
      staffUserId: packingStaff.id,
    });
  }

  // Scenario D — fully picked and handed over to packing (READY_TO_PACK).
  const handedOver = await createOrderWithPickJob({
    orderNumber: "#9104",
    productTitle: "Zip Hoodie",
    sku: "ZIPH-GRN-S",
    quantity: 5,
  });
  if (handedOver.pickJob) {
    const item = await db.warehousePickItem.findFirstOrThrow({
      where: { warehousePickJobId: handedOver.pickJob.id },
    });
    await recordPickQuantity({
      shopId: shop.id,
      warehousePickItemId: item.id,
      newlyPickedQuantity: item.requiredQuantity,
      idempotencyKey: "seed-warehouse-demo-handover",
      staffUserId: packingStaff.id,
    });
    await handoverWarehousePickJob({
      shopId: shop.id,
      warehousePickJobId: handedOver.pickJob.id,
      staffUserId: packingStaff.id,
    });
  }

  console.log(
    "Seeded Milestone 13 warehouse picking demo scenarios: " +
      "#9101 (queued), #9102 (in progress, assigned), #9103 (short line with issue), " +
      "#9104 (fully picked and handed over — order now READY_TO_PACK).",
  );
  console.log(`Demo Packing Staff: ${packingStaff.email}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
