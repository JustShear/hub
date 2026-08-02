import type { DecorationMethod } from "@prisma/client";
import type { Route } from "./+types/orders.$orderId.production-artwork";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { formString, formStringOrNull } from "~/lib/form-data";
import { createProductionArtwork } from "~/domain/production/create-production-artwork.server";
import { updateProductionArtwork } from "~/domain/production/update-production-artwork.server";
import { setProductionArtworkOrderLines } from "~/domain/production/allocate-production-artwork-order-lines.server";
import { markProductionArtworkReady } from "~/domain/production/mark-production-artwork-ready.server";
import { cancelProductionArtwork } from "~/domain/production/cancel-production-artwork.server";
import { createExportBatch, reExportBatch } from "~/domain/production/create-export-batch.server";

// Action-only resource route (no loader, no component) — every production
// artwork and export-batch mutation for this order goes through here,
// mirroring orders.$orderId.proof-groups.tsx's precedent. The drawer's own
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

  if (intent === "createProductionArtwork") {
    if (
      !hasPermission(staffUser, "production_artwork.create") ||
      !hasPermission(staffUser, "production_artwork.upload")
    ) {
      return {
        intent,
        ok: false,
        error: "You don't have permission to create production artwork.",
      };
    }
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { intent, ok: false, error: "A production artwork file is required." };
    }
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const decorationMethodRaw = formStringOrNull(formData, "decorationMethod");
    const productionMetadataRaw = formStringOrNull(formData, "productionMetadata");
    let productionMetadata: Record<string, unknown> | null = null;
    if (productionMetadataRaw) {
      try {
        productionMetadata = JSON.parse(productionMetadataRaw) as Record<string, unknown>;
      } catch {
        return { intent, ok: false, error: "Production metadata must be valid JSON." };
      }
    }
    const result = await createProductionArtwork({
      shopId: staffUser.shopId,
      proofGroupId: formString(formData, "proofGroupId"),
      fileBuffer,
      originalFilename: file.name,
      decorationMethod: (decorationMethodRaw as DecorationMethod | null) ?? null,
      placement: formStringOrNull(formData, "placement"),
      productionMetadata,
      staffUserId: staffUser.id,
      idempotencyKey: formStringOrNull(formData, "idempotencyKey"),
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason, issues: result.issues };
    }
    return {
      intent,
      ok: true,
      productionArtworkId: result.productionArtworkId,
      revisionNumber: result.revisionNumber,
    };
  }

  if (intent === "updateProductionArtwork") {
    if (!hasPermission(staffUser, "production_artwork.update")) {
      return { intent, ok: false, error: "You don't have permission to edit production artwork." };
    }
    const productionMetadataRaw = formStringOrNull(formData, "productionMetadata");
    let productionMetadata: Record<string, unknown> | null = null;
    if (productionMetadataRaw) {
      try {
        productionMetadata = JSON.parse(productionMetadataRaw) as Record<string, unknown>;
      } catch {
        return { intent, ok: false, error: "Production metadata must be valid JSON." };
      }
    }
    const result = await updateProductionArtwork({
      shopId: staffUser.shopId,
      productionArtworkId: formString(formData, "productionArtworkId"),
      decorationMethod: formString(formData, "decorationMethod") as DecorationMethod,
      placement: formStringOrNull(formData, "placement"),
      productionMetadata,
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return {
      intent,
      ok: true,
      validationStatus: result.validationStatus,
      validationMessages: result.validationMessages,
    };
  }

  if (intent === "setProductionArtworkOrderLines") {
    if (!hasPermission(staffUser, "production_artwork.update")) {
      return { intent, ok: false, error: "You don't have permission to edit production artwork." };
    }
    const orderLineIds = formData.getAll("orderLineId").map(String);
    const quantities = formData.getAll("quantity").map((q) => Number(q));
    const result = await setProductionArtworkOrderLines({
      shopId: staffUser.shopId,
      productionArtworkId: formString(formData, "productionArtworkId"),
      allocations: orderLineIds.map((orderLineId, i) => ({
        orderLineId,
        quantity: quantities[i] ?? 0,
      })),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "markProductionArtworkReady") {
    if (!hasPermission(staffUser, "production_artwork.update")) {
      return { intent, ok: false, error: "You don't have permission to edit production artwork." };
    }
    const result = await markProductionArtworkReady({
      shopId: staffUser.shopId,
      productionArtworkId: formString(formData, "productionArtworkId"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason, issues: result.issues };
    }
    return { intent, ok: true };
  }

  if (intent === "cancelProductionArtwork") {
    if (!hasPermission(staffUser, "production_artwork.cancel")) {
      return {
        intent,
        ok: false,
        error: "You don't have permission to cancel production artwork.",
      };
    }
    const result = await cancelProductionArtwork({
      shopId: staffUser.shopId,
      productionArtworkId: formString(formData, "productionArtworkId"),
      reason: formString(formData, "reason"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "createExportBatch") {
    if (!hasPermission(staffUser, "production_exports.create")) {
      return { intent, ok: false, error: "You don't have permission to export for print." };
    }
    const result = await createExportBatch({
      shopId: staffUser.shopId,
      orderId,
      proofGroupIds: formData.getAll("proofGroupId").map(String),
      destination: formStringOrNull(formData, "destination"),
      staffUserId: staffUser.id,
      idempotencyKey: formString(formData, "idempotencyKey"),
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason, issues: result.issues };
    }
    return {
      intent,
      ok: true,
      exportBatchId: result.exportBatchId,
      batchNumber: result.batchNumber,
    };
  }

  if (intent === "reExportBatch") {
    if (!hasPermission(staffUser, "production_exports.reexport")) {
      return { intent, ok: false, error: "You don't have permission to re-export." };
    }
    const result = await reExportBatch({
      shopId: staffUser.shopId,
      orderId,
      proofGroupIds: formData.getAll("proofGroupId").map(String),
      destination: formStringOrNull(formData, "destination"),
      staffUserId: staffUser.id,
      idempotencyKey: formString(formData, "idempotencyKey"),
      reexportReason: formString(formData, "reexportReason"),
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason, issues: result.issues };
    }
    return {
      intent,
      ok: true,
      exportBatchId: result.exportBatchId,
      batchNumber: result.batchNumber,
    };
  }

  return { intent: "unknown", ok: false, error: "Unknown action." };
}
