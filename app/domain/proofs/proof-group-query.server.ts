import type {
  DecorationMethod,
  NoProofReason,
  Priority,
  ProofGroupStatus,
  ProofRequirementValue,
  ProofVersionStatus,
} from "@prisma/client";
import { db } from "~/lib/db.server";
import { OPEN_STATUSES } from "~/domain/integrations/record-failure.server";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";
import { validateProofGroupReadiness, type ReadinessResult } from "~/domain/proofs/readiness";

const MAX_VERSIONS_PER_GROUP = 50;

export interface OrderDetailProofGroupLine {
  orderLineId: string;
  quantity: number;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  lineQuantity: number;
}

export interface OrderDetailProofGroupAsset {
  id: string;
  assetId: string;
  originalFilename: string | null;
  sourceUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  parsingUncertain: boolean;
  linkedByStaffId: string | null;
  linkedByStaffName: string | null;
  createdAt: string;
}

export interface OrderDetailProofVersionAsset {
  id: string;
  storageKey: string;
  isPrimary: boolean;
  sortOrder: number;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  width: number | null;
  height: number | null;
}

export interface OrderDetailProofNote {
  id: string;
  body: string;
  authorStaffId: string;
  authorStaffName: string;
  createdAt: string;
}

export interface OrderDetailProofVersion {
  id: string;
  versionNumber: number;
  status: ProofVersionStatus;
  internalNote: string | null;
  createdByStaffId: string;
  createdByStaffName: string;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  supersededByVersionId: string | null;
  assets: OrderDetailProofVersionAsset[];
  sourceAssetIds: string[];
  notes: OrderDetailProofNote[];
}

export interface OrderDetailProofGroup {
  id: string;
  name: string;
  decorationMethod: DecorationMethod;
  placement: string | null;
  description: string | null;
  status: ProofGroupStatus;
  requirement: ProofRequirementValue;
  noProofReason: NoProofReason | null;
  noProofReasonNote: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  dueDate: string | null;
  priority: Priority;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  orderLines: OrderDetailProofGroupLine[];
  assets: OrderDetailProofGroupAsset[];
  versions: OrderDetailProofVersion[];
  notes: OrderDetailProofNote[];
  hasOpenIntegrationFailure: boolean;
  integrationIssueSummary: string | null;
  readiness: ReadinessResult;
}

export async function loadProofGroupsForOrder(params: {
  shopId: string;
  orderId: string;
}): Promise<OrderDetailProofGroup[]> {
  const groups = await db.proofGroup.findMany({
    where: { orderId: params.orderId, order: { shopId: params.shopId } },
    orderBy: { createdAt: "asc" },
    include: {
      proofRequirement: true,
      orderLines: { include: { orderLine: true } },
      artworkAssetLinks: { include: { asset: true } },
      notes: { where: { proofVersionId: null }, orderBy: { createdAt: "desc" } },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: MAX_VERSIONS_PER_GROUP,
        include: {
          assets: { orderBy: { sortOrder: "asc" } },
          sourceAssets: true,
          notes: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });

  if (groups.length === 0) return [];

  const failures = await db.integrationFailure.findMany({
    where: { relatedProofGroupId: { in: groups.map((g) => g.id) }, status: { in: OPEN_STATUSES } },
    orderBy: { latestFailureAt: "desc" },
  });
  const failureByGroupId = new Map<string, (typeof failures)[number]>();
  for (const failure of failures) {
    if (failure.relatedProofGroupId && !failureByGroupId.has(failure.relatedProofGroupId)) {
      failureByGroupId.set(failure.relatedProofGroupId, failure);
    }
  }

  const staffIds = [
    ...groups.map((g) => g.assignedStaffId),
    ...groups.flatMap((g) => g.artworkAssetLinks.map((l) => l.linkedByStaffId)),
    ...groups.flatMap((g) => g.notes.map((n) => n.authorStaffId)),
    ...groups.flatMap((g) => g.versions.map((v) => v.createdByStaffId)),
    ...groups.flatMap((g) => g.versions.flatMap((v) => v.notes.map((n) => n.authorStaffId))),
  ];
  const staffNames = await resolveStaffNames(staffIds);

  return groups.map((group): OrderDetailProofGroup => {
    const requirement = group.proofRequirement?.value ?? "UNDETERMINED";
    const failure = failureByGroupId.get(group.id) ?? null;
    const latestVersion = group.versions[0] ?? null;

    const readiness = validateProofGroupReadiness({
      name: group.name,
      placement: group.placement,
      decorationMethod: group.decorationMethod,
      requirementValue: requirement,
      linkedLineCount: group.orderLines.length,
      currentVersion: latestVersion
        ? {
            status: latestVersion.status,
            hasStoredFile: latestVersion.assets.length > 0,
          }
        : null,
      hasOpenIntegrationFailure: failure !== null,
    });

    return {
      id: group.id,
      name: group.name,
      decorationMethod: group.decorationMethod,
      placement: group.placement,
      description: group.artworkContextNote,
      status: group.status,
      requirement,
      noProofReason: group.noProofReason,
      noProofReasonNote: group.proofRequirement?.reasonNote ?? null,
      assignedStaffId: group.assignedStaffId,
      assignedStaffName: group.assignedStaffId
        ? (staffNames.get(group.assignedStaffId) ?? "Unknown staff member")
        : null,
      dueDate: group.dueDate?.toISOString() ?? null,
      priority: group.priority,
      cancelledAt: group.cancelledAt?.toISOString() ?? null,
      cancelReason: group.cancelReason,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
      orderLines: group.orderLines.map((link) => ({
        orderLineId: link.orderLineId,
        quantity: link.quantity,
        productTitle: link.orderLine.productTitle,
        variantTitle: link.orderLine.variantTitle,
        sku: link.orderLine.sku,
        imageUrl: link.orderLine.imageUrl,
        lineQuantity: link.orderLine.quantity,
      })),
      assets: group.artworkAssetLinks.map((link) => ({
        id: link.id,
        assetId: link.assetId,
        originalFilename: link.asset.originalFilename,
        sourceUrl: link.asset.sourceUrl,
        mimeType: link.asset.mimeType,
        sizeBytes: link.asset.sizeBytes,
        parsingUncertain: link.asset.parsingUncertain,
        linkedByStaffId: link.linkedByStaffId,
        linkedByStaffName: link.linkedByStaffId
          ? (staffNames.get(link.linkedByStaffId) ?? "Unknown staff member")
          : null,
        createdAt: link.createdAt.toISOString(),
      })),
      versions: group.versions.map((version) => ({
        id: version.id,
        versionNumber: version.versionNumber,
        status: version.status,
        internalNote: version.internalNote,
        createdByStaffId: version.createdByStaffId,
        createdByStaffName: staffNames.get(version.createdByStaffId) ?? "Unknown staff member",
        createdAt: version.createdAt.toISOString(),
        cancelledAt: version.cancelledAt?.toISOString() ?? null,
        cancelReason: version.cancelReason,
        supersededByVersionId: version.supersededByVersionId,
        assets: version.assets.map((asset) => ({
          id: asset.id,
          storageKey: asset.storageKey,
          isPrimary: asset.isPrimary,
          sortOrder: asset.sortOrder,
          originalFilename: asset.originalFilename,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          checksum: asset.checksum,
          width: asset.width,
          height: asset.height,
        })),
        sourceAssetIds: version.sourceAssets.map((s) => s.assetId),
        notes: version.notes.map((note) => ({
          id: note.id,
          body: note.body,
          authorStaffId: note.authorStaffId,
          authorStaffName: staffNames.get(note.authorStaffId) ?? "Unknown staff member",
          createdAt: note.createdAt.toISOString(),
        })),
      })),
      notes: group.notes.map((note) => ({
        id: note.id,
        body: note.body,
        authorStaffId: note.authorStaffId,
        authorStaffName: staffNames.get(note.authorStaffId) ?? "Unknown staff member",
        createdAt: note.createdAt.toISOString(),
      })),
      hasOpenIntegrationFailure: failure !== null,
      integrationIssueSummary: failure?.summary ?? null,
      readiness,
    };
  });
}
