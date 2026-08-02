import type {
  ExceptionCaseCategory,
  ExceptionCaseInitiator,
  ExceptionResolutionType,
  Severity,
} from "@prisma/client";
import type { Route } from "./+types/exceptions.actions";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { formString, formStringOrNull } from "~/lib/form-data";
import { createExceptionCase } from "~/domain/exceptions/create-exception-case.server";
import { updateExceptionCase } from "~/domain/exceptions/update-exception-case.server";
import {
  cancelExceptionCase,
  markAwaitingCustomer,
  startInvestigation,
} from "~/domain/exceptions/transition-exception-case-status.server";
import { assignExceptionCase } from "~/domain/exceptions/assign-exception-case.server";
import { recordReturnLabel } from "~/domain/exceptions/record-return-label.server";
import { resolveExceptionCase } from "~/domain/exceptions/resolve-exception-case.server";
import { markResolutionCompleted } from "~/domain/exceptions/mark-resolution-completed.server";
import { addExceptionCaseNote } from "~/domain/exceptions/add-exception-case-note.server";
import { handleGenericSavedViewAction } from "~/domain/saved-views/generic-saved-view-action.server";
import { EXCEPTIONS_SAVED_VIEW_SCOPE } from "~/domain/saved-views/scopes";

// Action-only resource route (no loader, no component) — every exception-
// case mutation goes through here, whether triggered from the order
// drawer's Exceptions tab (order ID passed as a plain form field) or the
// /exceptions/:caseId workstation, mirroring production.actions.tsx/
// warehouse.actions.tsx's one-route-many-intents, dual-use convention.
export async function action({ request }: Route.ActionArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "exception_cases.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "createExceptionCase") {
    if (!hasPermission(staffUser, "exception_cases.create")) {
      return { intent, ok: false, error: "You don't have permission to report an exception case." };
    }
    const result = await createExceptionCase({
      shopId: staffUser.shopId,
      orderId: formString(formData, "orderId"),
      orderLineId: formStringOrNull(formData, "orderLineId"),
      category: formString(formData, "category") as ExceptionCaseCategory,
      initiatedBy: formString(formData, "initiatedBy") as ExceptionCaseInitiator,
      summary: formString(formData, "summary"),
      customerNote: formStringOrNull(formData, "customerNote"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return {
      intent,
      ok: true,
      exceptionCaseId: result.exceptionCaseId,
      caseNumber: result.caseNumber,
    };
  }

  if (intent === "updateExceptionCase") {
    if (!hasPermission(staffUser, "exception_cases.update")) {
      return { intent, ok: false, error: "You don't have permission to edit exception cases." };
    }
    const result = await updateExceptionCase({
      shopId: staffUser.shopId,
      exceptionCaseId: formString(formData, "exceptionCaseId"),
      expectedUpdatedAt: new Date(formString(formData, "expectedUpdatedAt")),
      category: formString(formData, "category") as ExceptionCaseCategory,
      severity: formString(formData, "severity") as Severity,
      summary: formString(formData, "summary"),
      customerNote: formStringOrNull(formData, "customerNote"),
      staffUserId: staffUser.id,
    });
    if (result.outcome !== "updated") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true, updatedAt: result.updatedAt };
  }

  if (intent === "startInvestigation" || intent === "markAwaitingCustomer") {
    if (!hasPermission(staffUser, "exception_cases.update")) {
      return {
        intent,
        ok: false,
        error: "You don't have permission to change an exception case's status.",
      };
    }
    const args = {
      shopId: staffUser.shopId,
      exceptionCaseId: formString(formData, "exceptionCaseId"),
      staffUserId: staffUser.id,
    };
    const result =
      intent === "startInvestigation"
        ? await startInvestigation(args)
        : await markAwaitingCustomer(args);
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "recordReturnLabel") {
    if (!hasPermission(staffUser, "exception_cases.update")) {
      return { intent, ok: false, error: "You don't have permission to record a return label." };
    }
    const result = await recordReturnLabel({
      shopId: staffUser.shopId,
      exceptionCaseId: formString(formData, "exceptionCaseId"),
      note: formString(formData, "note"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "cancelExceptionCase") {
    if (!hasPermission(staffUser, "exception_cases.cancel")) {
      return { intent, ok: false, error: "You don't have permission to cancel exception cases." };
    }
    const result = await cancelExceptionCase({
      shopId: staffUser.shopId,
      exceptionCaseId: formString(formData, "exceptionCaseId"),
      reason: formString(formData, "reason"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "assignExceptionCase") {
    if (!hasPermission(staffUser, "exception_cases.assign")) {
      return { intent, ok: false, error: "You don't have permission to assign exception cases." };
    }
    const result = await assignExceptionCase({
      shopId: staffUser.shopId,
      exceptionCaseId: formString(formData, "exceptionCaseId"),
      targetStaffUserId: formStringOrNull(formData, "targetStaffUserId"),
      expectedStaffUserId: formStringOrNull(formData, "expectedStaffUserId"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected" || result.outcome === "conflict") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "resolveExceptionCase") {
    if (!hasPermission(staffUser, "exception_cases.resolve")) {
      return {
        intent,
        ok: false,
        error: "You don't have permission to record a resolution for an exception case.",
      };
    }
    const amountRaw = formStringOrNull(formData, "amount");
    const result = await resolveExceptionCase({
      shopId: staffUser.shopId,
      exceptionCaseId: formString(formData, "exceptionCaseId"),
      resolutionType: formString(formData, "resolutionType") as ExceptionResolutionType,
      reason: formString(formData, "reason"),
      amount: amountRaw ? Number(amountRaw) : null,
      currencyCode: formStringOrNull(formData, "currencyCode"),
      proofGroupId: formStringOrNull(formData, "proofGroupId"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason, issues: result.issues };
    }
    return {
      intent,
      ok: true,
      resolutionId: result.resolutionId,
      exportBatchId: result.exportBatchId,
    };
  }

  if (intent === "markResolutionCompleted") {
    if (!hasPermission(staffUser, "exception_cases.resolve")) {
      return {
        intent,
        ok: false,
        error: "You don't have permission to mark a resolution completed.",
      };
    }
    const result = await markResolutionCompleted({
      shopId: staffUser.shopId,
      resolutionId: formString(formData, "resolutionId"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "addExceptionCaseNote") {
    if (!hasPermission(staffUser, "exception_notes.create")) {
      return { intent, ok: false, error: "You don't have permission to add exception case notes." };
    }
    const result = await addExceptionCaseNote({
      shopId: staffUser.shopId,
      exceptionCaseId: formString(formData, "exceptionCaseId"),
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
    scope: EXCEPTIONS_SAVED_VIEW_SCOPE,
  });
  if (savedViewResult) return savedViewResult;

  return { intent: "unknown", ok: false, error: "Unknown action." };
}
