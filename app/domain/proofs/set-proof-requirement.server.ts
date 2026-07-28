import {
  ActorType,
  OverrideType,
  type NoProofReason,
  type ProofRequirementValue,
} from "@prisma/client";
import { db } from "~/lib/db.server";
import { trimmedOrNull } from "~/lib/strings";
import { NO_PROOF_REASON_LABELS } from "~/domain/proofs/labels";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";
import type { ActiveProofGroupStatus } from "~/domain/proofs/labels";

export interface SetProofRequirementInput {
  shopId: string;
  proofGroupId: string;
  targetRequirement: ProofRequirementValue;
  expectedRequirement: ProofRequirementValue;
  noProofReason: NoProofReason | null;
  noProofReasonNote: string | null;
  /** Always required — both a routine decision and a reopen override need it recorded. */
  reason: string;
  staffUserId: string;
}

export type SetProofRequirementResult =
  | { outcome: "updated" }
  | { outcome: "already_there" }
  | { outcome: "rejected"; reason: string }
  | { outcome: "conflict"; reason: string; actualRequirement: ProofRequirementValue };

const STALE_EDIT_MESSAGE =
  "The proof requirement changed since you last saw it. Refresh to see the current value.";

// Milestone 08: no-proof-required decisions (setting OR reopening) always
// go through ManualOverride (OverrideType.MARK_NO_PROOF_REQUIRED) in
// addition to the plain ActivityEvent every change gets — the SRS ties this
// specific decision to the manual-override framework.
export async function setProofRequirement(
  input: SetProofRequirementInput,
): Promise<SetProofRequirementResult> {
  const group = await db.proofGroup.findFirst({
    where: { id: input.proofGroupId, order: { shopId: input.shopId } },
    include: { proofRequirement: true },
  });
  if (!group) {
    return { outcome: "rejected", reason: "Proof group not found." };
  }
  if (group.status === "CANCELLED") {
    return { outcome: "rejected", reason: "This proof group is cancelled." };
  }

  const currentRequirement: ProofRequirementValue = group.proofRequirement?.value ?? "UNDETERMINED";

  if (currentRequirement === input.targetRequirement) {
    return { outcome: "already_there" };
  }
  if (currentRequirement !== input.expectedRequirement) {
    return {
      outcome: "conflict",
      reason: STALE_EDIT_MESSAGE,
      actualRequirement: currentRequirement,
    };
  }

  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    return {
      outcome: "rejected",
      reason: "A reason is required when changing a proof group's requirement decision.",
    };
  }

  const isSettingNoProof = input.targetRequirement === "NOT_REQUIRED";
  const isReopeningNoProof = currentRequirement === "NOT_REQUIRED" && !isSettingNoProof;

  if (isSettingNoProof) {
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

  await db.$transaction(async (tx) => {
    if (group.proofRequirement) {
      await tx.proofRequirement.update({
        where: { id: group.proofRequirement.id },
        data: {
          value: input.targetRequirement,
          noProofReason: isSettingNoProof ? input.noProofReason : null,
          reasonNote: isSettingNoProof ? trimmedOrNull(input.noProofReasonNote) : null,
          decidedByStaffId: input.staffUserId,
          decidedAt: new Date(),
        },
      });
    } else {
      await tx.proofRequirement.create({
        data: {
          orderId: group.orderId,
          proofGroupId: group.id,
          value: input.targetRequirement,
          noProofReason: isSettingNoProof ? input.noProofReason : null,
          reasonNote: isSettingNoProof ? trimmedOrNull(input.noProofReasonNote) : null,
          decidedByStaffId: input.staffUserId,
          decidedAt: new Date(),
        },
      });
    }

    let newStatus: ActiveProofGroupStatus;
    if (isSettingNoProof) {
      newStatus = "NO_PROOF_REQUIRED";
    } else if (group.status === "NO_PROOF_REQUIRED") {
      const versionCount = await tx.proofVersion.count({
        where: { proofGroupId: group.id, status: { not: "CANCELLED" } },
      });
      newStatus = versionCount > 0 ? "DRAFT_IN_PROGRESS" : "NOT_STARTED";
    } else {
      newStatus = group.status as ActiveProofGroupStatus;
    }

    await tx.proofGroup.update({
      where: { id: group.id },
      data: {
        noProofReason: isSettingNoProof ? input.noProofReason : null,
        requiresApproval: !isSettingNoProof,
        status: newStatus,
      },
    });

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: group.orderId,
        entityType: "ProofGroup",
        entityId: group.id,
        eventType: "proof_requirement_changed",
        summary: `Proof requirement for "${group.name}" changed from ${currentRequirement} to ${input.targetRequirement}`,
        metadata: {
          previousRequirement: currentRequirement,
          newRequirement: input.targetRequirement,
          reason: trimmedReason,
          noProofReason: input.noProofReason,
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    if (isSettingNoProof || isReopeningNoProof) {
      const noProofReasonText =
        trimmedOrNull(input.noProofReasonNote) ??
        (input.noProofReason ? NO_PROOF_REASON_LABELS[input.noProofReason] : trimmedReason);
      await tx.manualOverride.create({
        data: {
          shopId: input.shopId,
          overrideType: OverrideType.MARK_NO_PROOF_REQUIRED,
          relatedEntityType: "ProofGroup",
          relatedEntityId: group.id,
          previousValue: { value: currentRequirement },
          newValue: { value: input.targetRequirement, noProofReason: input.noProofReason },
          reason: isReopeningNoProof ? trimmedReason : noProofReasonText,
          staffUserId: input.staffUserId,
        },
      });
    }

    await recalculateOrderProofSummary(tx, {
      shopId: input.shopId,
      orderId: group.orderId,
      actorStaffId: input.staffUserId,
    });
  });

  return { outcome: "updated" };
}
