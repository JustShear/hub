import type { ProductionIssueType, Severity } from "@prisma/client";
import type { Route } from "./+types/production.actions";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { formString, formStringOrNull } from "~/lib/form-data";
import {
  assignProductionJob,
  assignProductionTask,
} from "~/domain/production/assign-production-task.server";
import {
  pauseProductionTask,
  resumeProductionTask,
  startProductionTask,
} from "~/domain/production/task-lifecycle.server";
import { recordProductionQuantity } from "~/domain/production/record-production-quantity.server";
import { scanTaskQuantity } from "~/domain/production/scan-task-quantity.server";
import { performQualityCheck } from "~/domain/production/perform-quality-check.server";
import {
  createProductionIssue,
  resolveProductionIssue,
} from "~/domain/production/production-issue.server";
import {
  cancelProductionTask,
  completeProductionTask,
} from "~/domain/production/complete-production-task.server";
import { reopenProductionTask } from "~/domain/production/reopen-production-task.server";
import { addProductionNote } from "~/domain/production/add-production-note.server";
import { createProductionJobsFromExportBatch } from "~/domain/production/create-production-jobs.server";
import { handleGenericSavedViewAction } from "~/domain/saved-views/generic-saved-view-action.server";
import { PRODUCTION_SAVED_VIEW_SCOPE } from "~/domain/saved-views/scopes";

// Action-only resource route (no loader, no component) — every production
// job/task mutation goes through here, mirroring
// orders.$orderId.proof-groups.tsx's one-route-many-intents convention.
export async function action({ request }: Route.ActionArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "production_queue.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "createProductionJobs") {
    if (!hasPermission(staffUser, "production_jobs.create")) {
      return { intent, ok: false, error: "You don't have permission to create production jobs." };
    }
    const result = await createProductionJobsFromExportBatch({
      shopId: staffUser.shopId,
      exportBatchId: formString(formData, "exportBatchId"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return {
      intent,
      ok: true,
      createdJobIds: result.createdJobIds,
      createdTaskIds: result.createdTaskIds,
    };
  }

  if (intent === "assignTask") {
    if (!hasPermission(staffUser, "production_jobs.assign")) {
      return { intent, ok: false, error: "You don't have permission to assign production work." };
    }
    const targetStaffUserId = formStringOrNull(formData, "targetStaffUserId");
    const result = await assignProductionTask({
      shopId: staffUser.shopId,
      productionTaskId: formString(formData, "productionTaskId"),
      targetStaffUserId,
      expectedVersion: Number(formString(formData, "expectedVersion")),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected" || result.outcome === "conflict") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "assignJob") {
    if (!hasPermission(staffUser, "production_jobs.assign")) {
      return { intent, ok: false, error: "You don't have permission to assign production work." };
    }
    const result = await assignProductionJob({
      shopId: staffUser.shopId,
      productionJobId: formString(formData, "productionJobId"),
      targetStaffUserId: formStringOrNull(formData, "targetStaffUserId"),
      assignedTeam: formStringOrNull(formData, "assignedTeam"),
      expectedVersion: Number(formString(formData, "expectedVersion")),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected" || result.outcome === "conflict") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "startTask") {
    if (!hasPermission(staffUser, "production_jobs.start")) {
      return { intent, ok: false, error: "You don't have permission to start production work." };
    }
    const result = await startProductionTask({
      shopId: staffUser.shopId,
      productionTaskId: formString(formData, "productionTaskId"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "pauseTask") {
    if (!hasPermission(staffUser, "production_jobs.pause")) {
      return { intent, ok: false, error: "You don't have permission to pause production work." };
    }
    const result = await pauseProductionTask({
      shopId: staffUser.shopId,
      productionTaskId: formString(formData, "productionTaskId"),
      reasonCode: formString(formData, "reasonCode"),
      otherText: formStringOrNull(formData, "otherText"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "resumeTask") {
    if (!hasPermission(staffUser, "production_jobs.start")) {
      return { intent, ok: false, error: "You don't have permission to resume production work." };
    }
    const result = await resumeProductionTask({
      shopId: staffUser.shopId,
      productionTaskId: formString(formData, "productionTaskId"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "recordQuantity") {
    if (!hasPermission(staffUser, "production_quantities.update")) {
      return {
        intent,
        ok: false,
        error: "You don't have permission to record production quantities.",
      };
    }
    const overrideReason = formStringOrNull(formData, "overrideReason");
    if (overrideReason && !hasPermission(staffUser, "production_overrides.create")) {
      return {
        intent,
        ok: false,
        error: "You don't have permission to exceed the required quantity.",
      };
    }
    const result = await recordProductionQuantity({
      shopId: staffUser.shopId,
      productionTaskId: formString(formData, "productionTaskId"),
      newlyProducedQuantity: Number(formString(formData, "newlyProducedQuantity") || "0"),
      newlyFailedQuantity: Number(formString(formData, "newlyFailedQuantity") || "0"),
      reworkedQuantity: Number(formString(formData, "reworkedQuantity") || "0"),
      overrideReason,
      idempotencyKey: formString(formData, "idempotencyKey"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return {
      intent,
      ok: true,
      completedQuantity: result.completedQuantity,
      failedQuantity: result.failedQuantity,
    };
  }

  if (intent === "scanTaskQuantity") {
    if (!hasPermission(staffUser, "production_quantities.update")) {
      return {
        intent,
        ok: false,
        error: "You don't have permission to record production quantities.",
      };
    }
    const result = await scanTaskQuantity({
      shopId: staffUser.shopId,
      productionTaskId: formString(formData, "productionTaskId"),
      scannedValue: formString(formData, "scannedValue"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true, completedQuantity: result.completedQuantity };
  }

  if (intent === "performQualityCheck") {
    if (!hasPermission(staffUser, "production_quality_check.perform")) {
      return { intent, ok: false, error: "You don't have permission to perform quality checks." };
    }
    const checklistRaw = formStringOrNull(formData, "checklistResult");
    let checklistResult: Record<string, boolean> | null = null;
    if (checklistRaw) {
      try {
        checklistResult = JSON.parse(checklistRaw) as Record<string, boolean>;
      } catch {
        return { intent, ok: false, error: "The quality checklist result was malformed." };
      }
    }
    const result = await performQualityCheck({
      shopId: staffUser.shopId,
      productionTaskId: formString(formData, "productionTaskId"),
      checkedQuantity: Number(formString(formData, "checkedQuantity") || "0"),
      approvedQuantity: Number(formString(formData, "approvedQuantity") || "0"),
      failedQuantity: Number(formString(formData, "failedQuantity") || "0"),
      checklistResult,
      notes: formStringOrNull(formData, "notes"),
      failureReason: formStringOrNull(formData, "failureReason"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "createIssue") {
    if (!hasPermission(staffUser, "production_issues.create")) {
      return { intent, ok: false, error: "You don't have permission to report production issues." };
    }
    const reworkQuantityRaw = formStringOrNull(formData, "reworkQuantity");
    const result = await createProductionIssue({
      shopId: staffUser.shopId,
      productionJobId: formString(formData, "productionJobId"),
      productionTaskId: formStringOrNull(formData, "productionTaskId"),
      issueType: formString(formData, "issueType") as ProductionIssueType,
      severity: formString(formData, "severity") as Severity,
      description: formString(formData, "description"),
      isBlocking: formData.get("isBlocking") === "true",
      reworkQuantity: reworkQuantityRaw ? Number(reworkQuantityRaw) : null,
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true, issueId: result.issueId };
  }

  if (intent === "resolveIssue") {
    if (!hasPermission(staffUser, "production_issues.resolve")) {
      return {
        intent,
        ok: false,
        error: "You don't have permission to resolve production issues.",
      };
    }
    const result = await resolveProductionIssue({
      shopId: staffUser.shopId,
      productionIssueId: formString(formData, "productionIssueId"),
      resolution: formString(formData, "resolution"),
      cancel: formData.get("cancel") === "true",
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "completeTask") {
    if (!hasPermission(staffUser, "production_jobs.complete")) {
      return { intent, ok: false, error: "You don't have permission to complete production work." };
    }
    const result = await completeProductionTask({
      shopId: staffUser.shopId,
      productionTaskId: formString(formData, "productionTaskId"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason, issues: result.issues };
    }
    return { intent, ok: true };
  }

  if (intent === "cancelTask") {
    if (!hasPermission(staffUser, "production_jobs.update")) {
      return { intent, ok: false, error: "You don't have permission to cancel production work." };
    }
    const result = await cancelProductionTask({
      shopId: staffUser.shopId,
      productionTaskId: formString(formData, "productionTaskId"),
      reason: formString(formData, "reason"),
      markFailed: formData.get("markFailed") === "true",
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "reopenTask") {
    if (!hasPermission(staffUser, "production_jobs.reopen")) {
      return { intent, ok: false, error: "You don't have permission to reopen completed work." };
    }
    if (!hasPermission(staffUser, "production_overrides.create")) {
      return { intent, ok: false, error: "You don't have permission to perform this override." };
    }
    const result = await reopenProductionTask({
      shopId: staffUser.shopId,
      productionTaskId: formString(formData, "productionTaskId"),
      reason: formString(formData, "reason"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true, newStatus: result.newStatus };
  }

  if (intent === "createNote") {
    if (!hasPermission(staffUser, "production_notes.create")) {
      return { intent, ok: false, error: "You don't have permission to add production notes." };
    }
    const productionJobId = formStringOrNull(formData, "productionJobId");
    const productionTaskId = formStringOrNull(formData, "productionTaskId");
    const scope = productionTaskId
      ? ({ kind: "task", productionTaskId } as const)
      : ({ kind: "job", productionJobId: productionJobId ?? "" } as const);
    const result = await addProductionNote({
      shopId: staffUser.shopId,
      scope,
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
    scope: PRODUCTION_SAVED_VIEW_SCOPE,
  });
  if (savedViewResult) return savedViewResult;

  return { intent: "unknown", ok: false, error: "Unknown action." };
}
