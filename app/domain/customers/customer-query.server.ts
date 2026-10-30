import type { ChangeRequestCategory, DecorationMethod, Prisma } from "@prisma/client";
import { db } from "~/lib/db.server";
import {
  customerKeyFor,
  customerOrderWhere,
  type CustomerIdentity,
} from "~/domain/customers/customer-key";

// --- Customer list -------------------------------------------------------

export interface CustomerListItem {
  key: string;
  name: string | null;
  email: string | null;
  orderCount: number;
  lastOrderAt: string;
}

const CUSTOMER_LIST_LIMIT = 60;

/**
 * Customers are derived from the customer fields copied onto each order
 * (there is no customer table - see customer-key.ts). Grouped by Shopify
 * customer id + email so a repeat customer is one row however many orders
 * they have placed.
 */
export async function listCustomers(input: {
  shopId: string;
  search?: string;
}): Promise<CustomerListItem[]> {
  const term = input.search?.trim();
  const where: Prisma.ShopifyOrderWhereInput = {
    shopId: input.shopId,
    OR: [{ customerShopifyGid: { not: null } }, { customerEmail: { not: null } }],
    ...(term
      ? {
          AND: [
            {
              OR: [
                { customerName: { contains: term, mode: "insensitive" } },
                { customerEmail: { contains: term, mode: "insensitive" } },
                { orderNumber: { contains: term, mode: "insensitive" } },
              ],
            },
          ],
        }
      : {}),
  };

  const groups = await db.shopifyOrder.groupBy({
    by: ["customerShopifyGid", "customerEmail"],
    where,
    _count: { _all: true },
    _max: { shopifyCreatedAt: true },
    orderBy: { _max: { shopifyCreatedAt: "desc" } },
    take: CUSTOMER_LIST_LIMIT,
  });
  if (groups.length === 0) {
    return [];
  }

  // The newest order per customer supplies the display name (a name can be
  // edited between orders; the most recent is the one staff expect to see).
  const latestOrders = await db.shopifyOrder.findMany({
    where: {
      shopId: input.shopId,
      OR: groups.map((g) => ({
        customerShopifyGid: g.customerShopifyGid,
        customerEmail: g.customerEmail,
      })),
    },
    orderBy: { shopifyCreatedAt: "desc" },
    distinct: ["customerShopifyGid", "customerEmail"],
    select: { customerShopifyGid: true, customerEmail: true, customerName: true },
  });
  const nameByGroup = new Map(
    latestOrders.map((o) => [
      `${o.customerShopifyGid ?? ""}|${o.customerEmail ?? ""}`,
      o.customerName,
    ]),
  );

  const items: CustomerListItem[] = [];
  const seenKeys = new Set<string>();
  for (const group of groups) {
    const key = customerKeyFor(group);
    // The same person can appear twice if their email changed between
    // orders; the first (most recent) row wins and the list stays unique.
    if (!key || seenKeys.has(key) || !group._max.shopifyCreatedAt) continue;
    seenKeys.add(key);
    items.push({
      key,
      name:
        nameByGroup.get(`${group.customerShopifyGid ?? ""}|${group.customerEmail ?? ""}`) ?? null,
      email: group.customerEmail,
      orderCount: group._count._all,
      lastOrderAt: group._max.shopifyCreatedAt.toISOString(),
    });
  }
  return items;
}

// --- Customer proof file -------------------------------------------------

export interface CustomerProofCard {
  versionId: string;
  /** The proof image to show - null if the version has no uploaded file. */
  assetId: string | null;
  mimeType: string | null;
  orderId: string;
  orderNumber: string;
  groupName: string;
  decorationMethod: DecorationMethod;
  versionNumber: number;
  /** When it was approved / when the customer asked for changes. */
  at: string;
}

export interface CustomerChangesRequestedCard extends CustomerProofCard {
  customerNote: string | null;
  categories: ChangeRequestCategory[];
  /** True when a later version of the same proof group has since been approved. */
  laterApproved: boolean;
}

export interface CustomerProofFile {
  customer: {
    name: string | null;
    email: string | null;
    phone: string | null;
    orderCount: number;
  };
  accepted: CustomerProofCard[];
  changesRequested: CustomerChangesRequestedCard[];
}

/**
 * Everything the customer file shows: for each of the customer's proof
 * groups, the final approved version (one per group - the latest, if a
 * group was somehow approved twice) and every version the customer sent
 * back with changes. Returns null when the customer has no orders in this
 * shop, so the route can 404 rather than render an empty stranger.
 *
 * There is no REJECTED proof status in the Hub: a customer either approves
 * or requests changes, so "rejected or changes requested" is one list.
 */
export async function loadCustomerProofFile(input: {
  shopId: string;
  identity: CustomerIdentity;
}): Promise<CustomerProofFile | null> {
  const orders = await db.shopifyOrder.findMany({
    where: { shopId: input.shopId, ...customerOrderWhere(input.identity) },
    orderBy: { shopifyCreatedAt: "desc" },
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
    },
  });
  if (orders.length === 0) {
    return null;
  }
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const groups = await db.proofGroup.findMany({
    where: { orderId: { in: orders.map((o) => o.id) }, status: { not: "CANCELLED" } },
    select: {
      id: true,
      orderId: true,
      name: true,
      decorationMethod: true,
      versions: {
        where: { status: { in: ["APPROVED", "CHANGES_REQUESTED"] } },
        orderBy: { versionNumber: "desc" },
        select: {
          id: true,
          versionNumber: true,
          status: true,
          createdAt: true,
          approvedAt: true,
          respondedAt: true,
          assets: {
            orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
            take: 1,
            select: { id: true, mimeType: true },
          },
          responses: {
            where: { responseType: "CHANGES_REQUESTED" },
            orderBy: { respondedAt: "desc" },
            take: 1,
            select: { customerNote: true, changeCategories: true, respondedAt: true },
          },
        },
      },
    },
  });

  const accepted: CustomerProofCard[] = [];
  const changesRequested: CustomerChangesRequestedCard[] = [];

  for (const group of groups) {
    const order = orderById.get(group.orderId);
    if (!order) continue;

    const base = (version: (typeof group.versions)[number], at: Date): CustomerProofCard => ({
      versionId: version.id,
      assetId: version.assets[0]?.id ?? null,
      mimeType: version.assets[0]?.mimeType ?? null,
      orderId: order.id,
      orderNumber: order.orderNumber,
      groupName: group.name,
      decorationMethod: group.decorationMethod,
      versionNumber: version.versionNumber,
      at: at.toISOString(),
    });

    // Versions arrive newest-first, so the first APPROVED one is the final
    // accepted proof for this group.
    const finalApproved = group.versions.find((v) => v.status === "APPROVED");
    if (finalApproved) {
      accepted.push(
        base(
          finalApproved,
          finalApproved.approvedAt ?? finalApproved.respondedAt ?? finalApproved.createdAt,
        ),
      );
    }

    for (const version of group.versions) {
      if (version.status !== "CHANGES_REQUESTED") continue;
      const response = version.responses[0];
      changesRequested.push({
        ...base(version, response?.respondedAt ?? version.respondedAt ?? version.createdAt),
        customerNote: response?.customerNote ?? null,
        categories: response?.changeCategories ?? [],
        laterApproved:
          finalApproved !== undefined && finalApproved.versionNumber > version.versionNumber,
      });
    }
  }

  const newestFirst = (a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at);
  accepted.sort(newestFirst);
  changesRequested.sort(newestFirst);

  const latest = orders[0];
  return {
    customer: {
      name: latest?.customerName ?? null,
      email: latest?.customerEmail ?? null,
      phone: latest?.customerPhone ?? null,
      orderCount: orders.length,
    },
    accepted,
    changesRequested,
  };
}
