import {
  ActorType,
  type DecorationMethod,
  OverrideType,
  Prisma,
  type NoProofReason,
  type Priority,
  type ProofRequirementValue,
} from "@prisma/client";
import { db } from "~/lib/db.server";
import { trimmedOrNull } from "~/lib/strings";
import { DECORATION_METHOD_LABELS, NO_PROOF_REASON_LABELS } from "~/domain/proofs/labels";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";

export interface CreateProofGroupInput {
  shopId: string;
  orderId: string;
  name: string;
  decorationMethod: DecorationMethod;
  placement: string | null;
  description: string | null;
  /** Defaults to UNDETERMINED unless the caller explicitly chose otherwise — never inferred from upload presence. */
  requirement: ProofRequirementValue;
  noProofReason: NoProofReason | null;
  noProofReasonNote: string | null;
  orderLineIds: string[];
  assetIds: string[];
  assignedStaffId: string | null;
  dueDate: Date | null;
  priority: Priority | null;
  staffUserId: string;
}

export type CreateProofGroupResult =
  { outcome: "created"; proofGroupId: string } | { outcome: "rejected"; reason: string };

export async function createProofGroup(
  input: CreateProofGroupInput,
): Promise<CreateProofGroupResult> {
  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    select: { id: true },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }

  // Name is a convenience label, not a required decision — staff can leave
  // it blank and fill it in later; fall back to a sensible auto-generated
  // one derived from decoration method + placement (matching how
  // description/placement are already optional) rather than blocking
  // creation on it.
  const trimmedName =
    input.name.trim() ||
    [DECORATION_METHOD_LABELS[input.decorationMethod], trimmedOrNull(input.placement)]
      .filter(Boolean)
      .join(" — ");

  if (input.requirement === "NOT_REQUIRED") {
    if (!input.noProofReason) {
      return {
        outcome: "rejected",
        reason: "A reason is required when marking a group as no proof required.",
      };
    }
    if (input.noProofReason === "OTHER" && !(input.noProofReasonNote ?? "").trim()) {
      return {
        outcome: "rejected",
        reason: 'Explanatory text is required when the reason is "Other".',
      };
    }
  }

  let lineQuantities = new Map<string, number>();
  if (input.orderLineIds.length > 0) {
    const lines = await db.shopifyOrderLine.findMany({
      where: { id: { in: input.orderLineIds }, orderId: input.orderId },
      select: { id: true, quantity: true },
    });
    if (lines.length !== input.orderLineIds.length) {
      return {
        outcome: "rejected",
        reason: "One or more selected order lines don't belong to this order.",
      };
    }
    lineQuantities = new Map(lines.map((l) => [l.id, l.quantity]));
  }

  if (input.assetIds.length > 0) {
    const validAssetCount = await db.customerArtworkAsset.count({
      where: { id: { in: input.assetIds }, shopId: input.shopId },
    });
    if (validAssetCount !== input.assetIds.length) {
      return {
        outcome: "rejected",
        reason: "One or more selected artwork assets don't belong to this shop.",
      };
    }
  }

  const isNoProofRequired = input.requirement === "NOT_REQUIRED";
  const noProofReasonText =
    trimmedOrNull(input.noProofReasonNote) ??
    (input.noProofReason ? NO_PROOF_REASON_LABELS[input.noProofReason] : "");

  const created = await db.$transaction(async (tx) => {
    const group = await tx.proofGroup.create({
      data: {
        orderId: input.orderId,
        name: trimmedName,
        decorationMethod: input.decorationMethod,
        placement: trimmedOrNull(input.placement),
        artworkContextNote: trimmedOrNull(input.description),
        assignedStaffId: input.assignedStaffId,
        dueDate: input.dueDate,
        priority: input.priority ?? undefined,
        status: isNoProofRequired ? "NO_PROOF_REQUIRED" : "NOT_STARTED",
        requiresApproval: !isNoProofRequired,
        noProofReason: isNoProofRequired ? input.noProofReason : null,
      },
    });

    await tx.proofRequirement.create({
      data: {
        orderId: input.orderId,
        proofGroupId: group.id,
        value: input.requirement,
        noProofReason: isNoProofRequired ? input.noProofReason : null,
        reasonNote: isNoProofRequired ? trimmedOrNull(input.noProofReasonNote) : null,
        decidedByStaffId: input.requirement !== "UNDETERMINED" ? input.staffUserId : null,
        decidedAt: input.requirement !== "UNDETERMINED" ? new Date() : null,
      },
    });

    if (input.orderLineIds.length > 0) {
      await tx.proofGroupOrderLine.createMany({
        data: input.orderLineIds.map((orderLineId) => ({
          proofGroupId: group.id,
          orderLineId,
          quantity: lineQuantities.get(orderLineId) ?? 1,
        })),
      });
    }

    if (input.assetIds.length > 0) {
      await tx.proofGroupArtworkAsset.createMany({
        data: input.assetIds.map((assetId) => ({
          proofGroupId: group.id,
          assetId,
          linkedByStaffId: input.staffUserId,
        })),
      });
    }

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: input.orderId,
        entityType: "ProofGroup",
        entityId: group.id,
        eventType: "proof_group_created",
        summary: `Proof group "${trimmedName}" created`,
        metadata: {
          decorationMethod: input.decorationMethod,
          requirement: input.requirement,
          orderLineCount: input.orderLineIds.length,
          assetCount: input.assetIds.length,
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    if (isNoProofRequired) {
      await tx.manualOverride.create({
        data: {
          shopId: input.shopId,
          overrideType: OverrideType.MARK_NO_PROOF_REQUIRED,
          relatedEntityType: "ProofGroup",
          relatedEntityId: group.id,
          previousValue: Prisma.JsonNull,
          newValue: { value: "NOT_REQUIRED", noProofReason: input.noProofReason },
          reason: noProofReasonText,
          staffUserId: input.staffUserId,
        },
      });
    }

    await recalculateOrderProofSummary(tx, {
      shopId: input.shopId,
      orderId: input.orderId,
      actorStaffId: input.staffUserId,
    });

    return group;
  });

  return { outcome: "created", proofGroupId: created.id };
}
