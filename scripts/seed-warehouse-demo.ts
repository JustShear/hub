// Development-only fixture generator for manually verifying warehouse
// picking (Milestone 13). Creates its own small, self-contained orders
// (rather than reusing #9022 from the production demo, whose scenarios are
// deliberately left in various incomplete states — a WarehousePickJob only
// ever appears once an order's production genuinely reaches COMPLETE) and
// walks each fully through proof group -> production artwork -> export
// batch -> production task -> completion, so the real auto-creation hook
// in recalculateOrderProductionSummary fires exactly as it would for a
// genuine order. Entirely synthetic data. Safe to re-run: each order is
// looked up by its orderNumber first and reused rather than recreated.
//
// Usage:
//   npm run db:seed:warehouse-demo

import { randomUUID } from "node:crypto";
import { db } from "../app/lib/db.server";
import { hashPassword } from "../app/auth/password.server";
import { createProofGroup } from "../app/domain/proofs/create-proof-group.server";
import { createProductionArtwork } from "../app/domain/production/create-production-artwork.server";
import { setProductionArtworkOrderLines } from "../app/domain/production/allocate-production-artwork-order-lines.server";
import { markProductionArtworkReady } from "../app/domain/production/mark-production-artwork-ready.server";
import { createExportBatch } from "../app/domain/production/create-export-batch.server";
import { startProductionTask } from "../app/domain/production/task-lifecycle.server";
import { recordProductionQuantity } from "../app/domain/production/record-production-quantity.server";
import { performQualityCheck } from "../app/domain/production/perform-quality-check.server";
import { completeProductionTask } from "../app/domain/production/complete-production-task.server";
import { assignWarehousePickJob } from "../app/domain/warehouse/assign-warehouse-pick-job.server";
import { recordPickQuantity } from "../app/domain/warehouse/record-pick-quantity.server";
import { markPickItemShort } from "../app/domain/warehouse/mark-pick-item-short.server";
import { handoverWarehousePickJob } from "../app/domain/warehouse/handover-warehouse-pick-job.server";

const DEMO_PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", "utf8");

async function main() {
  const shop = await db.shop.findFirstOrThrow();

  const artworkStaffRole = await db.role.findUniqueOrThrow({
    where: { shopId_name: { shopId: shop.id, name: "ARTWORK_STAFF" } },
  });
  const artworkStaff = await db.staffUser.upsert({
    where: { shopId_email: { shopId: shop.id, email: "demo.artwork.wh@justshear.example" } },
    update: {},
    create: {
      shopId: shop.id,
      email: "demo.artwork.wh@justshear.example",
      name: "Priya Nair",
      passwordHash: await hashPassword(randomUUID()),
    },
  });
  await db.staffRole.upsert({
    where: { staffUserId_roleId: { staffUserId: artworkStaff.id, roleId: artworkStaffRole.id } },
    update: {},
    create: { staffUserId: artworkStaff.id, roleId: artworkStaffRole.id },
  });

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

  // Creates a small self-contained order with one line, then drives it
  // through proof group (no-proof-required) -> production artwork ->
  // export batch -> the auto-created production task -> completion. That
  // final completeProductionTask call is what makes the order's
  // productionSummary genuinely reach COMPLETE, which is what triggers the
  // real WarehousePickJob auto-creation hook (recalculateOrderProductionSummary).
  async function createOrderWithCompletedProduction(params: {
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
        tags: [],
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

    const group = await createProofGroup({
      shopId: shop.id,
      orderId: order.id,
      name: `Warehouse demo — ${params.orderNumber}`,
      decorationMethod: "SCREEN_PRINT",
      placement: "Front chest",
      description: null,
      requirement: "NOT_REQUIRED",
      noProofReason: "APPROVED_STANDARD_LOGO",
      noProofReasonNote: "Synthetic Milestone 13 demo scenario.",
      orderLineIds: [line.id],
      assetIds: [],
      assignedStaffId: artworkStaff.id,
      dueDate: null,
      priority: "NORMAL",
      staffUserId: artworkStaff.id,
    });
    if (group.outcome !== "created") {
      throw new Error(
        `Failed to seed proof group for "${params.orderNumber}": ${JSON.stringify(group)}`,
      );
    }

    const artwork = await createProductionArtwork({
      shopId: shop.id,
      proofGroupId: group.proofGroupId,
      fileBuffer: DEMO_PDF_BYTES,
      originalFilename: `${params.orderNumber}-production.pdf`,
      decorationMethod: null,
      placement: "Front chest",
      productionMetadata: null,
      staffUserId: artworkStaff.id,
      idempotencyKey: null,
    });
    if (artwork.outcome !== "created") {
      throw new Error(`Failed to seed production artwork for "${params.orderNumber}"`);
    }

    const allocation = await setProductionArtworkOrderLines({
      shopId: shop.id,
      productionArtworkId: artwork.productionArtworkId,
      allocations: [{ orderLineId: line.id, quantity: params.quantity }],
      staffUserId: artworkStaff.id,
    });
    if (allocation.outcome !== "set") {
      throw new Error(`Failed to allocate order lines for "${params.orderNumber}"`);
    }

    const ready = await markProductionArtworkReady({
      shopId: shop.id,
      productionArtworkId: artwork.productionArtworkId,
      staffUserId: artworkStaff.id,
    });
    if (ready.outcome !== "ready") {
      throw new Error(`Failed to mark "${params.orderNumber}" artwork ready`);
    }

    const exportResult = await createExportBatch({
      shopId: shop.id,
      orderId: order.id,
      proofGroupIds: [group.proofGroupId],
      destination: "Milestone 13 demo destination",
      staffUserId: artworkStaff.id,
      idempotencyKey: `seed-warehouse-demo-${group.proofGroupId}`,
    });
    if (exportResult.outcome !== "exported") {
      throw new Error(`Failed to export "${params.orderNumber}": ${JSON.stringify(exportResult)}`);
    }

    const task = await db.productionTask.findFirstOrThrow({
      where: { productionJob: { exportBatchId: exportResult.exportBatchId } },
    });
    await startProductionTask({
      shopId: shop.id,
      productionTaskId: task.id,
      staffUserId: artworkStaff.id,
    });
    await recordProductionQuantity({
      shopId: shop.id,
      productionTaskId: task.id,
      newlyProducedQuantity: task.requiredQuantity,
      newlyFailedQuantity: 0,
      reworkedQuantity: 0,
      overrideReason: null,
      idempotencyKey: `seed-warehouse-demo-qty-${task.id}`,
      staffUserId: artworkStaff.id,
    });
    await performQualityCheck({
      shopId: shop.id,
      productionTaskId: task.id,
      checkedQuantity: task.requiredQuantity,
      approvedQuantity: task.requiredQuantity,
      failedQuantity: 0,
      checklistResult: { correct_artwork: true },
      notes: null,
      failureReason: null,
      staffUserId: artworkStaff.id,
    });
    const completeResult = await completeProductionTask({
      shopId: shop.id,
      productionTaskId: task.id,
      staffUserId: artworkStaff.id,
    });
    if (completeResult.outcome === "rejected") {
      throw new Error(
        `Failed to complete production for "${params.orderNumber}": ${JSON.stringify(completeResult)}`,
      );
    }

    const pickJob = await db.warehousePickJob.findUnique({ where: { orderId: order.id } });
    return { order, line, pickJob };
  }

  // Scenario A — freshly queued, nothing picked yet.
  await createOrderWithCompletedProduction({
    orderNumber: "#9101",
    productTitle: "Classic Hoodie",
    sku: "HOOD-BLK-M",
    quantity: 10,
  });

  // Scenario B — in progress, a partial pick recorded.
  const inProgress = await createOrderWithCompletedProduction({
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
  const short = await createOrderWithCompletedProduction({
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
  const handedOver = await createOrderWithCompletedProduction({
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
