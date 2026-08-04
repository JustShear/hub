import type { Route } from "./+types/orders.$orderId.freight";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { formString, formStringOrNull } from "~/lib/form-data";
import { createFreightShipment } from "~/domain/freight/create-freight-shipment.server";
import { cancelFreightShipment } from "~/domain/freight/cancel-freight-shipment.server";
import { syncFreightTrackingToShopify } from "~/domain/freight/sync-tracking-to-shopify.server";
import { getDeliveryRates } from "~/domain/freight/get-delivery-rates.server";
import { markOrderFulfilledManually } from "~/domain/freight/mark-order-fulfilled-manually.server";

function formOptionalFloat(formData: FormData, key: string): number | null {
  const raw = formStringOrNull(formData, key);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

// Action-only resource route (no loader, no component) — every freight
// shipment mutation for this order goes through here, mirroring
// orders.$orderId.production-artwork.tsx's precedent. The drawer's own
// loader (orders.$orderId.tsx) returns the read side of this data.
export async function action({ request, params }: Route.ActionArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "orders.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const orderId = params.orderId;
  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "createFreightShipment") {
    if (!hasPermission(staffUser, "freight_shipments.create")) {
      return { intent, ok: false, error: "You don't have permission to create freight shipments." };
    }
    const result = await createFreightShipment({
      shopId: staffUser.shopId,
      orderId,
      carrierCode: formString(formData, "carrierCode"),
      carrierServiceCode: formString(formData, "carrierServiceCode"),
      packagingPresetName: formStringOrNull(formData, "packagingPresetName"),
      staffUserId: staffUser.id,
      idempotencyKey: formString(formData, "idempotencyKey"),
      weightKg: formOptionalFloat(formData, "weightKg"),
      heightM: formOptionalFloat(formData, "heightM"),
      widthM: formOptionalFloat(formData, "widthM"),
      lengthM: formOptionalFloat(formData, "lengthM"),
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return {
      intent,
      ok: true,
      freightShipmentId: result.freightShipmentId,
      trackingNumber: "trackingNumber" in result ? result.trackingNumber : null,
    };
  }

  if (intent === "cancelFreightShipment") {
    if (!hasPermission(staffUser, "freight_shipments.cancel")) {
      return { intent, ok: false, error: "You don't have permission to cancel freight shipments." };
    }
    const result = await cancelFreightShipment({
      shopId: staffUser.shopId,
      freightShipmentId: formString(formData, "freightShipmentId"),
      reason: formString(formData, "reason"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "getDeliveryRates") {
    if (!hasPermission(staffUser, "freight_shipments.create")) {
      return { intent, ok: false, error: "You don't have permission to create freight shipments." };
    }
    const weightKg = formOptionalFloat(formData, "weightKg");
    if (weightKg === null) {
      return { intent, ok: false, error: "Weight is required to get rates." };
    }
    const result = await getDeliveryRates({
      shopId: staffUser.shopId,
      orderId,
      weightKg,
      heightM: formOptionalFloat(formData, "heightM"),
      widthM: formOptionalFloat(formData, "widthM"),
      lengthM: formOptionalFloat(formData, "lengthM"),
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true, services: result.services };
  }

  if (intent === "retryShopifySync") {
    if (!hasPermission(staffUser, "freight_shipments.create")) {
      return { intent, ok: false, error: "You don't have permission to retry the Shopify sync." };
    }
    const result = await syncFreightTrackingToShopify({
      shopId: staffUser.shopId,
      freightShipmentId: formString(formData, "freightShipmentId"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "markFulfilledManually") {
    if (!hasPermission(staffUser, "freight_shipments.create")) {
      return { intent, ok: false, error: "You don't have permission to mark orders fulfilled." };
    }
    const result = await markOrderFulfilledManually({
      shopId: staffUser.shopId,
      orderId,
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  return { intent: "unknown", ok: false, error: "Unknown action." };
}
