import { createHash, randomUUID } from "node:crypto";
import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { storageAdapter } from "~/adapters/storage/get-storage-adapter.server";
import {
  createStarshipitOrder,
  findStarshipitOrderByOrderNumber,
  printStarshipitLabel,
} from "~/adapters/starshipit/starshipit-client.server";
import { evaluateFreightShipmentEligibility } from "~/domain/freight/freight-eligibility";
import { buildStarshipitDestination } from "~/domain/freight/parse-shipping-address";
import { syncFreightTrackingToShopify } from "~/domain/freight/sync-tracking-to-shopify.server";

const OPEN_SHIPMENT_STATUSES = ["PREPARING", "CREATED"] as const;

export interface CreateFreightShipmentInput {
  shopId: string;
  orderId: string;
  carrierCode: string;
  carrierServiceCode: string;
  packagingPresetName: string | null;
  staffUserId: string;
  /** Client-generated once per creation attempt — a retry with the same key returns the already-created shipment. */
  idempotencyKey: string;
  /** Optional — the same package details a rate quote (if any) was based on, so the label matches what was priced. */
  weightKg?: number | null;
  heightM?: number | null;
  widthM?: number | null;
  lengthM?: number | null;
}

export type CreateFreightShipmentResult =
  | { outcome: "created"; freightShipmentId: string; trackingNumber: string | null }
  | { outcome: "duplicate"; freightShipmentId: string }
  | { outcome: "rejected"; reason: string };

/**
 * Reserve-then-finalise, the same three-phase shape as createExportBatch:
 * (1) reserve a PREPARING row before any external I/O, (2) call Starshipit
 * outside any DB transaction, (3) a CAS-checked finalisation update. The
 * Shopify tracking write-back happens as a separate, independently-failable
 * step after finalisation — a downstream Shopify sync failure must never
 * undo a shipment that already genuinely happened with the carrier.
 */
export async function createFreightShipment(
  input: CreateFreightShipmentInput,
): Promise<CreateFreightShipmentResult> {
  // findFirst (not findUnique) so shopId can be included in the where clause
  // even though idempotencyKey alone is already globally unique — a
  // defense-in-depth check that a caller can never get back another shop's
  // freightShipmentId by guessing or reusing its idempotencyKey.
  const existingByKey = await db.freightShipment.findFirst({
    where: { idempotencyKey: input.idempotencyKey, shopId: input.shopId },
  });
  if (existingByKey) {
    return { outcome: "duplicate", freightShipmentId: existingByKey.id };
  }

  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    include: { lines: { select: { productTitle: true, sku: true, quantity: true } } },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }

  const activeShipmentCount = await db.freightShipment.count({
    where: { orderId: input.orderId, status: { in: [...OPEN_SHIPMENT_STATUSES] } },
  });
  const eligibility = evaluateFreightShipmentEligibility({
    productionSummary: order.productionSummary,
    hasActiveShipment: activeShipmentCount > 0,
    orderCancelledAt: order.cancelledAt,
  });
  if (!eligibility.eligible) {
    return { outcome: "rejected", reason: eligibility.reason ?? "This order isn't eligible yet." };
  }

  const destinationResult = buildStarshipitDestination(order.shippingAddress, order.customerName);
  if (!destinationResult.valid || !destinationResult.destination) {
    return {
      outcome: "rejected",
      reason: destinationResult.reason ?? "This order's shipping address is incomplete.",
    };
  }

  const carrierCode = input.carrierCode.trim();
  const carrierServiceCode = input.carrierServiceCode.trim();
  const trimmedPackagingPresetName = input.packagingPresetName?.trim() ?? "";
  const packagingPresetName =
    trimmedPackagingPresetName.length > 0 ? trimmedPackagingPresetName : null;
  if (!carrierCode || !carrierServiceCode) {
    return { outcome: "rejected", reason: "A carrier and service level are required." };
  }

  // Phase 1: reserve, before any external I/O.
  const reserved = await db.freightShipment.create({
    data: {
      shopId: input.shopId,
      orderId: input.orderId,
      status: "PREPARING",
      idempotencyKey: input.idempotencyKey,
      carrierCode,
      carrierServiceCode,
      packagingPresetName,
      weightKg: input.weightKg,
      heightM: input.heightM,
      widthM: input.widthM,
      lengthM: input.lengthM,
      createdByStaffId: input.staffUserId,
    },
  });

  // Phase 2: call Starshipit, outside any DB transaction.
  //
  // Some Starshipit accounts have their own native Shopify integration that
  // auto-imports every order well before this app ever touches it (confirmed
  // against a real account — see ADR-0008's addendum). Calling
  // createStarshipitOrder for an order Starshipit already has would create a
  // genuine duplicate, so look it up first by the Shopify order number
  // (Starshipit stores it without the leading "#") and only create a new one
  // if it's genuinely not there.
  const shopifyOrderNumberForLookup = order.orderNumber.replace(/^#/, "");
  const lookupResult = await findStarshipitOrderByOrderNumber(shopifyOrderNumberForLookup);
  if (!lookupResult.ok) {
    await failFreightShipment(reserved.id, lookupResult.errorSummary);
    return { outcome: "rejected", reason: lookupResult.errorSummary };
  }

  let starshipitOrderId: string;
  if (lookupResult.found) {
    starshipitOrderId = lookupResult.starshipitOrderId;
  } else {
    const createResult = await createStarshipitOrder({
      orderNumber: reserved.idempotencyKey,
      reference: order.orderNumber,
      currency: order.currencyCode,
      signatureRequired: false,
      shippingMethod: order.shippingMethod,
      destination: destinationResult.destination,
      items: order.lines.map((line) => ({
        description: line.productTitle,
        sku: line.sku,
        quantity: line.quantity,
        weight: null,
        value: null,
      })),
      packagingPresetName,
    });
    if (!createResult.ok) {
      await failFreightShipment(reserved.id, createResult.errorSummary);
      return { outcome: "rejected", reason: createResult.errorSummary };
    }
    starshipitOrderId = createResult.starshipitOrderId;
  }

  const weightKg = input.weightKg ?? null;
  const labelResult = await printStarshipitLabel({
    starshipitOrderId,
    carrierCode,
    carrierServiceCode,
    package:
      weightKg !== null
        ? {
            weightKg,
            heightM: input.heightM ?? null,
            widthM: input.widthM ?? null,
            lengthM: input.lengthM ?? null,
          }
        : undefined,
  });
  if (!labelResult.ok) {
    await failFreightShipment(reserved.id, labelResult.errorSummary);
    return { outcome: "rejected", reason: labelResult.errorSummary };
  }

  let labelStorageKey: string;
  let labelChecksum: string;
  try {
    const labelBuffer = Buffer.from(labelResult.labelPdfBase64, "base64");
    labelChecksum = createHash("sha256").update(labelBuffer).digest("hex");
    labelStorageKey = `freight-shipments/${input.orderId}/${randomUUID()}.pdf`;
    await storageAdapter.putObject({ key: labelStorageKey, body: labelBuffer });
  } catch (error) {
    await failFreightShipment(reserved.id, `Failed to store the freight label: ${String(error)}`);
    throw error;
  }

  // Phase 3: the CAS finalisation update.
  const finalized = await db.freightShipment.updateMany({
    where: { id: reserved.id, status: "PREPARING" },
    data: {
      status: "CREATED",
      starshipitOrderId,
      carrierName: labelResult.carrierName,
      trackingNumber: labelResult.trackingNumber,
      labelStorageKey,
      labelChecksum,
    },
  });
  if (finalized.count === 0) {
    await storageAdapter.deleteObject(labelStorageKey).catch(() => {
      // Best-effort cleanup only.
    });
    return {
      outcome: "rejected",
      reason:
        "This shipment changed state while it was being created. Please review and try again.",
    };
  }

  await db.activityEvent.create({
    data: {
      shopId: input.shopId,
      orderId: input.orderId,
      entityType: "FreightShipment",
      entityId: reserved.id,
      eventType: "freight_shipment_created",
      summary: `Freight label created (${labelResult.carrierName ?? carrierCode}${labelResult.trackingNumber ? `, tracking ${labelResult.trackingNumber}` : ""})`,
      metadata: {
        carrierCode,
        carrierServiceCode,
        trackingNumber: labelResult.trackingNumber,
      },
      actorStaffId: input.staffUserId,
      actorType: ActorType.STAFF,
    },
  });

  // Separate, independently-failable step — a Shopify sync failure must
  // never undo a shipment that already genuinely happened with the carrier.
  // Recorded via the existing IntegrationFailure/STARSHIPIT mechanism on
  // failure; the shipment itself stays CREATED either way.
  try {
    await syncFreightTrackingToShopify({
      shopId: input.shopId,
      freightShipmentId: reserved.id,
      staffUserId: input.staffUserId,
    });
  } catch {
    // Swallowed deliberately — see sync-tracking-to-shopify.server.ts, which
    // records its own failure via recordIntegrationFailure and never throws
    // under normal operation; this catch only guards against a genuinely
    // unexpected error so the shipment's own success is never rolled back.
  }

  return {
    outcome: "created",
    freightShipmentId: reserved.id,
    trackingNumber: labelResult.trackingNumber,
  };
}

async function failFreightShipment(freightShipmentId: string, reason: string): Promise<void> {
  await db.freightShipment.updateMany({
    where: { id: freightShipmentId, status: "PREPARING" },
    data: { status: "FAILED", cancelReason: reason },
  });
}
