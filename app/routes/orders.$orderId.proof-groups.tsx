import type {
  DecorationMethod,
  NoProofReason,
  Priority,
  ProofRequirementValue,
} from "@prisma/client";
import type { Route } from "./+types/orders.$orderId.proof-groups";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { formString, formStringOrNull } from "~/lib/form-data";
import { createProofGroup } from "~/domain/proofs/create-proof-group.server";
import { updateProofGroup } from "~/domain/proofs/update-proof-group.server";
import { setProofRequirement } from "~/domain/proofs/set-proof-requirement.server";
import { cancelProofGroup } from "~/domain/proofs/cancel-proof-group.server";
import {
  linkProofGroupLine,
  unlinkProofGroupLine,
} from "~/domain/proofs/link-proof-group-line.server";
import {
  linkProofGroupAsset,
  unlinkProofGroupAsset,
} from "~/domain/proofs/link-proof-group-asset.server";
import { assignProofGroup } from "~/domain/proofs/assign-proof-group.server";
import { createProofVersion } from "~/domain/proofs/create-proof-version.server";
import { markProofVersionReady } from "~/domain/proofs/mark-proof-version-ready.server";
import { cancelProofVersion } from "~/domain/proofs/cancel-proof-version.server";
import { addProofNote } from "~/domain/proofs/add-proof-note.server";

// Action-only resource route (no loader, no component) — every proof-group
// and proof-version mutation for this order goes through here, mirroring
// orders.$orderId.more.tsx's split-out-a-focused-route precedent. The
// drawer's own loader (orders.$orderId.tsx) is what actually returns proof
// group data; this route only ever handles writes.
export async function action({ request, params }: Route.ActionArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "orders.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const orderId = params.orderId;
  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "createProofGroup") {
    if (!hasPermission(staffUser, "proof_groups.create")) {
      return { intent, ok: false, error: "You don't have permission to create proof groups." };
    }
    const requirementRaw = formString(formData, "requirement");
    const noProofReasonRaw = formStringOrNull(formData, "noProofReason");
    const dueDateRaw = formStringOrNull(formData, "dueDate");
    const priorityRaw = formStringOrNull(formData, "priority");
    const result = await createProofGroup({
      shopId: staffUser.shopId,
      orderId,
      name: formString(formData, "name"),
      decorationMethod: formString(formData, "decorationMethod") as DecorationMethod,
      placement: formStringOrNull(formData, "placement"),
      description: formStringOrNull(formData, "description"),
      requirement: (requirementRaw.length > 0
        ? requirementRaw
        : "UNDETERMINED") as ProofRequirementValue,
      noProofReason: noProofReasonRaw as NoProofReason | null,
      noProofReasonNote: formStringOrNull(formData, "noProofReasonNote"),
      orderLineIds: formData.getAll("orderLineId").map(String),
      assetIds: formData.getAll("assetId").map(String),
      assignedStaffId: formStringOrNull(formData, "assignedStaffId"),
      dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
      priority: (priorityRaw as Priority | null) ?? null,
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true, proofGroupId: result.proofGroupId };
  }

  if (intent === "updateProofGroup") {
    if (!hasPermission(staffUser, "proof_groups.update")) {
      return { intent, ok: false, error: "You don't have permission to edit proof groups." };
    }
    const dueDateRaw = formStringOrNull(formData, "dueDate");
    const result = await updateProofGroup({
      shopId: staffUser.shopId,
      proofGroupId: formString(formData, "proofGroupId"),
      expectedUpdatedAt: new Date(formString(formData, "expectedUpdatedAt")),
      name: formString(formData, "name"),
      decorationMethod: formString(formData, "decorationMethod") as DecorationMethod,
      placement: formStringOrNull(formData, "placement"),
      description: formStringOrNull(formData, "description"),
      dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
      priority: formString(formData, "priority") as Priority,
      staffUserId: staffUser.id,
    });
    if (result.outcome !== "updated") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true, updatedAt: result.updatedAt };
  }

  if (intent === "setProofRequirement") {
    if (!hasPermission(staffUser, "proof_groups.requirement.update")) {
      return {
        intent,
        ok: false,
        error: "You don't have permission to change a proof group's requirement.",
      };
    }
    const noProofReasonRaw = formStringOrNull(formData, "noProofReason");
    const result = await setProofRequirement({
      shopId: staffUser.shopId,
      proofGroupId: formString(formData, "proofGroupId"),
      targetRequirement: formString(formData, "targetRequirement") as ProofRequirementValue,
      expectedRequirement: formString(formData, "expectedRequirement") as ProofRequirementValue,
      noProofReason: noProofReasonRaw as NoProofReason | null,
      noProofReasonNote: formStringOrNull(formData, "noProofReasonNote"),
      reason: formString(formData, "reason"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected" || result.outcome === "conflict") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "cancelProofGroup") {
    if (!hasPermission(staffUser, "proof_groups.cancel")) {
      return { intent, ok: false, error: "You don't have permission to cancel proof groups." };
    }
    const result = await cancelProofGroup({
      shopId: staffUser.shopId,
      proofGroupId: formString(formData, "proofGroupId"),
      reason: formString(formData, "reason"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "linkProofGroupLine" || intent === "unlinkProofGroupLine") {
    if (!hasPermission(staffUser, "proof_groups.update")) {
      return { intent, ok: false, error: "You don't have permission to edit proof groups." };
    }
    const args = {
      shopId: staffUser.shopId,
      proofGroupId: formString(formData, "proofGroupId"),
      orderLineId: formString(formData, "orderLineId"),
      staffUserId: staffUser.id,
    };
    const result =
      intent === "linkProofGroupLine"
        ? await linkProofGroupLine(args)
        : await unlinkProofGroupLine(args);
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "linkProofGroupAsset" || intent === "unlinkProofGroupAsset") {
    if (!hasPermission(staffUser, "proof_groups.update")) {
      return { intent, ok: false, error: "You don't have permission to edit proof groups." };
    }
    const args = {
      shopId: staffUser.shopId,
      proofGroupId: formString(formData, "proofGroupId"),
      assetId: formString(formData, "assetId"),
      staffUserId: staffUser.id,
    };
    const result =
      intent === "linkProofGroupAsset"
        ? await linkProofGroupAsset(args)
        : await unlinkProofGroupAsset(args);
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "assignProofGroup") {
    if (!hasPermission(staffUser, "proof_artwork.assign")) {
      return { intent, ok: false, error: "You don't have permission to assign proof groups." };
    }
    const result = await assignProofGroup({
      shopId: staffUser.shopId,
      proofGroupId: formString(formData, "proofGroupId"),
      targetStaffUserId: formStringOrNull(formData, "targetStaffUserId"),
      expectedStaffUserId: formStringOrNull(formData, "expectedStaffUserId"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected" || result.outcome === "conflict") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "createProofVersion") {
    if (
      !hasPermission(staffUser, "proof_versions.create") ||
      !hasPermission(staffUser, "proof_versions.upload")
    ) {
      return { intent, ok: false, error: "You don't have permission to create proof versions." };
    }
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { intent, ok: false, error: "A proof file is required." };
    }
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const result = await createProofVersion({
      shopId: staffUser.shopId,
      proofGroupId: formString(formData, "proofGroupId"),
      fileBuffer,
      originalFilename: file.name,
      internalNote: formStringOrNull(formData, "internalNote"),
      sourceAssetIds: formData.getAll("sourceAssetId").map(String),
      idempotencyKey: formStringOrNull(formData, "idempotencyKey"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return {
      intent,
      ok: true,
      proofVersionId: result.proofVersionId,
      versionNumber: result.versionNumber,
    };
  }

  if (intent === "markProofVersionReady") {
    if (!hasPermission(staffUser, "proof_versions.status.update")) {
      return {
        intent,
        ok: false,
        error: "You don't have permission to change a proof version's status.",
      };
    }
    const result = await markProofVersionReady({
      shopId: staffUser.shopId,
      proofVersionId: formString(formData, "proofVersionId"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason, issues: result.issues };
    }
    return { intent, ok: true };
  }

  if (intent === "cancelProofVersion") {
    if (!hasPermission(staffUser, "proof_versions.status.update")) {
      return {
        intent,
        ok: false,
        error: "You don't have permission to change a proof version's status.",
      };
    }
    const result = await cancelProofVersion({
      shopId: staffUser.shopId,
      proofVersionId: formString(formData, "proofVersionId"),
      reason: formString(formData, "reason"),
      staffUserId: staffUser.id,
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "addProofNote") {
    if (!hasPermission(staffUser, "proof_artwork.notes.create")) {
      return { intent, ok: false, error: "You don't have permission to add proof notes." };
    }
    const proofGroupId = formStringOrNull(formData, "proofGroupId");
    const proofVersionId = formStringOrNull(formData, "proofVersionId");
    const scope = proofVersionId
      ? ({ kind: "version", proofVersionId } as const)
      : ({ kind: "group", proofGroupId: proofGroupId ?? "" } as const);
    const result = await addProofNote({
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

  return { intent: "unknown", ok: false, error: "Unknown action." };
}
