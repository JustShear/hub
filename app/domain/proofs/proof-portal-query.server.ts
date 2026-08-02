import type { DecorationMethod } from "@prisma/client";
import { db } from "~/lib/db.server";

// Everything returned here is safe to show a customer — no internal notes,
// due dates, priority, staff assignment, integration failures, Shopify raw
// data, activity history, or any other proof request. Only the exact
// groups/versions this specific ProofRequest bundled are ever visible.

export interface CustomerProofPortalAsset {
  id: string;
  mimeType: string | null;
  isPrimary: boolean;
}

export interface CustomerProofPortalVersion {
  id: string;
  versionNumber: number;
  assets: CustomerProofPortalAsset[];
}

export type CustomerProofResponseStatus =
  "APPROVED" | "CHANGES_REQUESTED" | "AWAITING_RESPONSE" | "SUPERSEDED";

export interface CustomerProofPortalGroup {
  proofGroupId: string;
  name: string;
  decorationMethod: DecorationMethod;
  placement: string | null;
  products: { productTitle: string; variantTitle: string | null; imageUrl: string | null }[];
  sentVersion: CustomerProofPortalVersion;
  /** Read-only history of every version that was ever actually sent to a customer for this group — never a version still in internal draft. */
  previousVersions: CustomerProofPortalVersion[];
  responseStatus: CustomerProofResponseStatus;
  response: { responseType: string; customerNote: string | null; respondedAt: string } | null;
}

export interface CustomerProofPortalData {
  orderNumber: string;
  customerName: string | null;
  staffMessage: string | null;
  groups: CustomerProofPortalGroup[];
  allResolved: boolean;
}

export async function loadCustomerProofPortalData(
  proofRequestId: string,
): Promise<CustomerProofPortalData> {
  const request = await db.proofRequest.findUniqueOrThrow({
    where: { id: proofRequestId },
    include: {
      order: { select: { orderNumber: true } },
      groups: {
        orderBy: { createdAt: "asc" },
        include: {
          proofGroup: {
            include: { orderLines: { include: { orderLine: true } } },
          },
          proofVersion: {
            include: {
              assets: { orderBy: { sortOrder: "asc" } },
              responses: { orderBy: { respondedAt: "desc" }, take: 1 },
            },
          },
        },
      },
    },
  });

  const groupIds = request.groups.map((g) => g.proofGroupId);
  const sentVersionsByGroup = await db.proofVersion.findMany({
    where: { proofGroupId: { in: groupIds }, requestLinks: { some: {} } },
    orderBy: { versionNumber: "desc" },
    include: { assets: { orderBy: { sortOrder: "asc" } } },
  });
  const sentVersionsGrouped = new Map<string, typeof sentVersionsByGroup>();
  for (const version of sentVersionsByGroup) {
    const list = sentVersionsGrouped.get(version.proofGroupId) ?? [];
    list.push(version);
    sentVersionsGrouped.set(version.proofGroupId, list);
  }

  let allResolved = true;
  const groups: CustomerProofPortalGroup[] = request.groups.map((link) => {
    const version = link.proofVersion;
    const response = version.responses[0] ?? null;

    let responseStatus: CustomerProofResponseStatus;
    if (version.status === "APPROVED") {
      responseStatus = "APPROVED";
    } else if (version.status === "CHANGES_REQUESTED") {
      responseStatus = "CHANGES_REQUESTED";
    } else if (version.status === "SENT" || version.status === "VIEWED") {
      responseStatus = "AWAITING_RESPONSE";
      allResolved = false;
    } else {
      // SUPERSEDED/CANCELLED/anything else — a newer proof exists internally.
      responseStatus = "SUPERSEDED";
      allResolved = false;
    }

    const allSentVersions = sentVersionsGrouped.get(link.proofGroupId) ?? [];

    return {
      proofGroupId: link.proofGroupId,
      name: link.proofGroup.name,
      decorationMethod: link.proofGroup.decorationMethod,
      placement: link.proofGroup.placement,
      products: link.proofGroup.orderLines.map((l) => ({
        productTitle: l.orderLine.productTitle,
        variantTitle: l.orderLine.variantTitle,
        imageUrl: l.orderLine.imageUrl,
      })),
      sentVersion: {
        id: version.id,
        versionNumber: version.versionNumber,
        assets: version.assets.map((a) => ({
          id: a.id,
          mimeType: a.mimeType,
          isPrimary: a.isPrimary,
        })),
      },
      previousVersions: allSentVersions
        .filter((v) => v.id !== version.id)
        .map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          assets: v.assets.map((a) => ({ id: a.id, mimeType: a.mimeType, isPrimary: a.isPrimary })),
        })),
      responseStatus,
      response: response
        ? {
            responseType: response.responseType,
            customerNote: response.customerNote,
            respondedAt: response.respondedAt.toISOString(),
          }
        : null,
    };
  });

  return {
    orderNumber: request.order.orderNumber,
    customerName: request.customerName,
    staffMessage: request.staffMessage,
    groups,
    allResolved,
  };
}
