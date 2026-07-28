import type { DueDateType, Priority } from "@prisma/client";
import type { Route } from "./+types/orders.$orderId";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { formString, formStringOrNull } from "~/lib/form-data";
import { getAssignableStaff, loadOrderDetail } from "~/domain/orders/order-detail-query.server";
import { updateOrderAssignment } from "~/domain/orders/update-assignment.server";
import { updateOrderPriority } from "~/domain/orders/update-priority.server";
import { setOrderDueDate } from "~/domain/orders/update-due-date.server";
import { addOrderNote } from "~/domain/orders/add-note.server";
import { db } from "~/lib/db.server";
import { OrderDrawer } from "~/components/order-drawer/OrderDrawer";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData.order.orderNumber} — Just Shear Production Hub` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "orders.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const canViewIntegrations = hasPermission(staffUser, "integrations.view");
  const canEditAssignment = hasPermission(staffUser, "orders.assignment.update");
  const canAssignProofArtwork = hasPermission(staffUser, "proof_artwork.assign");

  const order = await loadOrderDetail({
    shopId: staffUser.shopId,
    orderId: params.orderId,
    includeIntegrationTechnicalDetail: canViewIntegrations,
  });

  if (!order) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Order not found", { status: 404 });
  }

  const [assignableStaff, shop] = await Promise.all([
    canEditAssignment || canAssignProofArtwork
      ? getAssignableStaff(staffUser.shopId)
      : Promise.resolve([]),
    db.shop.findUnique({ where: { id: staffUser.shopId }, select: { shopifyDomain: true } }),
  ]);

  const canCreateProofVersions =
    hasPermission(staffUser, "proof_versions.create") &&
    hasPermission(staffUser, "proof_versions.upload");

  return {
    order,
    shopDomain: shop?.shopifyDomain ?? null,
    assignableStaff,
    canEditAssignment,
    canEditPriority: hasPermission(staffUser, "orders.priority.update"),
    canEditDueDates: hasPermission(staffUser, "orders.due_dates.update"),
    canViewNotes: hasPermission(staffUser, "notes.internal.view"),
    canCreateNotes: hasPermission(staffUser, "notes.internal.create"),
    canViewRawData: hasPermission(staffUser, "raw_data.view"),
    canViewIntegrations,
    canViewProofGroups: hasPermission(staffUser, "proof_groups.view"),
    canCreateProofGroups: hasPermission(staffUser, "proof_groups.create"),
    canUpdateProofGroups: hasPermission(staffUser, "proof_groups.update"),
    canCancelProofGroups: hasPermission(staffUser, "proof_groups.cancel"),
    canUpdateProofRequirement: hasPermission(staffUser, "proof_groups.requirement.update"),
    canCreateProofVersions,
    canUpdateProofVersionStatus: hasPermission(staffUser, "proof_versions.status.update"),
    canAssignProofArtwork,
    canCreateProofNotes: hasPermission(staffUser, "proof_artwork.notes.create"),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "orders.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("_intent");
  const orderId = params.orderId;

  if (intent === "updateAssignment") {
    if (!hasPermission(staffUser, "orders.assignment.update")) {
      return {
        intent: "updateAssignment" as const,
        ok: false,
        error: "You don't have permission to change assignment.",
      };
    }
    const targetStaffUserId = formStringOrNull(formData, "targetStaffUserId");
    const expectedStaffUserId = formStringOrNull(formData, "expectedStaffUserId");

    const result = await updateOrderAssignment({
      shopId: staffUser.shopId,
      orderId,
      targetStaffUserId,
      expectedStaffUserId,
      staffUserId: staffUser.id,
    });

    if (result.outcome === "rejected" || result.outcome === "conflict") {
      return { intent: "updateAssignment" as const, ok: false, error: result.reason };
    }
    return { intent: "updateAssignment" as const, ok: true };
  }

  if (intent === "updatePriority") {
    if (!hasPermission(staffUser, "orders.priority.update")) {
      return {
        intent: "updatePriority" as const,
        ok: false,
        error: "You don't have permission to change priority.",
      };
    }
    const targetPriorityRaw = formString(formData, "targetPriority");
    const expectedPriorityRaw = formString(formData, "expectedPriority");
    const reason = formString(formData, "reason");
    if (!targetPriorityRaw || !expectedPriorityRaw) {
      return {
        intent: "updatePriority" as const,
        ok: false,
        error: "Missing priority parameters.",
      };
    }

    const result = await updateOrderPriority({
      shopId: staffUser.shopId,
      orderId,
      targetPriority: targetPriorityRaw as Priority,
      expectedPriority: expectedPriorityRaw as Priority,
      reason,
      staffUserId: staffUser.id,
    });

    if (result.outcome === "rejected" || result.outcome === "conflict") {
      return { intent: "updatePriority" as const, ok: false, error: result.reason };
    }
    return { intent: "updatePriority" as const, ok: true };
  }

  if (intent === "setDueDate") {
    if (!hasPermission(staffUser, "orders.due_dates.update")) {
      return {
        intent: "setDueDate" as const,
        ok: false,
        error: "You don't have permission to change due dates.",
      };
    }
    const type = formString(formData, "type");
    const targetDueDateRaw = formStringOrNull(formData, "targetDueDate");
    const expectedDueDateRaw = formStringOrNull(formData, "expectedDueDate");
    const reason = formString(formData, "reason");
    if (!type) {
      return { intent: "setDueDate" as const, ok: false, error: "Missing due-date type." };
    }

    const result = await setOrderDueDate({
      shopId: staffUser.shopId,
      orderId,
      type: type as DueDateType,
      targetDueDate: targetDueDateRaw ? new Date(targetDueDateRaw) : null,
      expectedDueDate: expectedDueDateRaw ? new Date(expectedDueDateRaw) : null,
      reason,
      staffUserId: staffUser.id,
    });

    if (result.outcome === "rejected" || result.outcome === "conflict") {
      return { intent: "setDueDate" as const, ok: false, error: result.reason };
    }
    return { intent: "setDueDate" as const, ok: true };
  }

  if (intent === "addNote") {
    if (!hasPermission(staffUser, "notes.internal.create")) {
      return {
        intent: "addNote" as const,
        ok: false,
        error: "You don't have permission to add notes.",
      };
    }
    const body = formString(formData, "body");
    const result = await addOrderNote({
      shopId: staffUser.shopId,
      orderId,
      body,
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent: "addNote" as const, ok: false, error: result.reason };
    }
    return { intent: "addNote" as const, ok: true };
  }

  return { intent: "unknown" as const, ok: false, error: "Unknown action." };
}

export default function OrderDrawerRoute({ loaderData }: Route.ComponentProps) {
  return <OrderDrawer {...loaderData} />;
}
