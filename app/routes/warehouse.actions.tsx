import type { Severity, WarehouseIssueType } from "@prisma/client";
import type { Route } from "./+types/warehouse.actions";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { formString, formStringOrNull } from "~/lib/form-data";
import { assignWarehousePickJob } from "~/domain/warehouse/assign-warehouse-pick-job.server";
import { recordPickQuantity } from "~/domain/warehouse/record-pick-quantity.server";
import { scanPickQuantity } from "~/domain/warehouse/scan-pick-quantity.server";
import { markPickItemShort } from "~/domain/warehouse/mark-pick-item-short.server";
import {
  createWarehouseIssue,
  resolveWarehouseIssue,
} from "~/domain/warehouse/warehouse-issue.server";
import { handoverWarehousePickJob } from "~/domain/warehouse/handover-warehouse-pick-job.server";
import { cancelWarehousePickJob } from "~/domain/warehouse/cancel-warehouse-pick-job.server";
import { createWarehouseNote } from "~/domain/warehouse/create-warehouse-note.server";
import { handleGenericSavedViewAction } from "~/domain/saved-views/generic-saved-view-action.server";
import { WAREHOUSE_SAVED_VIEW_SCOPE } from "~/domain/saved-views/scopes";

// Action-only resource route (no loader, no component) — every warehouse
// pick job/item mutation goes through here, mirroring
// production.actions.tsx's one-route-many-intents convention.
export async function action({ request }: Route.ActionArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "warehouse_picks.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "assignJob") {
    if (!hasPermission(staffUser, "warehouse_picks.assign")) {
      return { intent, ok: false, error: "You don't have permission to assign warehouse work." };
    }
    const result = await assignWarehousePickJob({
      shopId: staffUser.shopId,
      warehousePickJobId: formString(formData, "warehousePickJobId"),
      targetStaffUserId: formStringOrNull(formData, "targetStaffUserId"),
      expectedVersion: Number(formString(formData, "expectedVersion")),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected" || result.outcome === "conflict") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "recordQuantity") {
    if (!hasPermission(staffUser, "warehouse_picks.record_quantity")) {
      return { intent, ok: false, error: "You don't have permission to record picked quantities." };
    }
    const result = await recordPickQuantity({
      shopId: staffUser.shopId,
      warehousePickItemId: formString(formData, "warehousePickItemId"),
      newlyPickedQuantity: Number(formString(formData, "newlyPickedQuantity") || "0"),
      idempotencyKey: formString(formData, "idempotencyKey"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true, pickedQuantity: result.pickedQuantity };
  }

  if (intent === "scanPickQuantity") {
    if (!hasPermission(staffUser, "warehouse_picks.record_quantity")) {
      return { intent, ok: false, error: "You don't have permission to record picked quantities." };
    }
    const result = await scanPickQuantity({
      shopId: staffUser.shopId,
      warehousePickItemId: formString(formData, "warehousePickItemId"),
      scannedValue: formString(formData, "scannedValue"),
      overrideReason: formStringOrNull(formData, "overrideReason"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected" || result.outcome === "mismatch") {
      return { intent, ok: false, error: result.reason };
    }
    return {
      intent,
      ok: true,
      pickedQuantity: result.pickedQuantity,
      scanResult: result.scanResult,
    };
  }

  if (intent === "markShort") {
    if (!hasPermission(staffUser, "warehouse_picks.mark_short")) {
      return { intent, ok: false, error: "You don't have permission to mark a line short." };
    }
    const result = await markPickItemShort({
      shopId: staffUser.shopId,
      warehousePickItemId: formString(formData, "warehousePickItemId"),
      reason: formString(formData, "reason"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true, shortQuantity: result.shortQuantity };
  }

  if (intent === "createIssue") {
    if (!hasPermission(staffUser, "warehouse_issues.create")) {
      return { intent, ok: false, error: "You don't have permission to report warehouse issues." };
    }
    const result = await createWarehouseIssue({
      shopId: staffUser.shopId,
      warehousePickJobId: formString(formData, "warehousePickJobId"),
      warehousePickItemId: formStringOrNull(formData, "warehousePickItemId"),
      issueType: formString(formData, "issueType") as WarehouseIssueType,
      severity: formString(formData, "severity") as Severity,
      description: formString(formData, "description"),
      isBlocking: formData.get("isBlocking") === "true",
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true, issueId: result.issueId };
  }

  if (intent === "resolveIssue") {
    if (!hasPermission(staffUser, "warehouse_issues.resolve")) {
      return { intent, ok: false, error: "You don't have permission to resolve warehouse issues." };
    }
    const result = await resolveWarehouseIssue({
      shopId: staffUser.shopId,
      warehouseIssueId: formString(formData, "warehouseIssueId"),
      resolutionNote: formString(formData, "resolutionNote"),
      cancel: formData.get("cancel") === "true",
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "handoverJob") {
    if (!hasPermission(staffUser, "warehouse_picks.handover")) {
      return { intent, ok: false, error: "You don't have permission to hand over to packing." };
    }
    const result = await handoverWarehousePickJob({
      shopId: staffUser.shopId,
      warehousePickJobId: formString(formData, "warehousePickJobId"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "cancelJob") {
    if (!hasPermission(staffUser, "warehouse_picks.assign")) {
      return {
        intent,
        ok: false,
        error: "You don't have permission to cancel a warehouse pick job.",
      };
    }
    const result = await cancelWarehousePickJob({
      shopId: staffUser.shopId,
      warehousePickJobId: formString(formData, "warehousePickJobId"),
      reason: formString(formData, "reason"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "createNote") {
    if (!hasPermission(staffUser, "warehouse_notes.create")) {
      return { intent, ok: false, error: "You don't have permission to add warehouse notes." };
    }
    const result = await createWarehouseNote({
      shopId: staffUser.shopId,
      warehousePickJobId: formString(formData, "warehousePickJobId"),
      body: formString(formData, "body"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  const savedViewResult = await handleGenericSavedViewAction({
    intent,
    formData,
    staffUserId: staffUser.id,
    shopId: staffUser.shopId,
    scope: WAREHOUSE_SAVED_VIEW_SCOPE,
  });
  if (savedViewResult) return savedViewResult;

  return { intent: "unknown", ok: false, error: "Unknown action." };
}
