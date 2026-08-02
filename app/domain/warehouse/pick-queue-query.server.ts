import type { Prisma, Priority, WarehousePickJobStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import { daysSince } from "~/lib/dates";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";
import type {
  WarehouseQueueFilters,
  WarehouseQueueSortField,
} from "~/domain/warehouse/pick-queue-filters";

export const WAREHOUSE_QUEUE_PAGE_SIZE = 40;

const OPEN_ISSUE_STATUSES = ["OPEN", "INVESTIGATING", "WAITING"] as const;

const PRIORITY_RANK: Record<Priority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 };

const JOB_SELECT = {
  id: true,
  orderId: true,
  status: true,
  priority: true,
  assignedStaffId: true,
  createdAt: true,
  handedOverAt: true,
  order: { select: { orderNumber: true, customerName: true } },
  items: { select: { status: true } },
} satisfies Prisma.WarehousePickJobSelect;

type JobRow = Prisma.WarehousePickJobGetPayload<{ select: typeof JOB_SELECT }>;

export interface WarehouseQueueCard {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  status: WarehousePickJobStatus;
  priority: Priority;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  jobAgeDays: number;
  lineCount: number;
  pickedLineCount: number;
  remainingLineCount: number;
  hasShortItem: boolean;
  hasOpenIssue: boolean;
}

function toCard(
  row: JobRow,
  now: Date,
  staffNames: Map<string, string>,
  openIssueJobIds: Set<string>,
): WarehouseQueueCard {
  const lineCount = row.items.length;
  const pickedLineCount = row.items.filter(
    (i) => i.status === "PICKED" || i.status === "SHORT",
  ).length;

  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.order.orderNumber,
    customerName: row.order.customerName,
    status: row.status,
    priority: row.priority,
    assignedStaffId: row.assignedStaffId,
    assignedStaffName: row.assignedStaffId
      ? (staffNames.get(row.assignedStaffId) ?? "Unknown staff member")
      : null,
    jobAgeDays: daysSince(row.createdAt, now),
    lineCount,
    pickedLineCount,
    remainingLineCount: lineCount - pickedLineCount,
    hasShortItem: row.items.some((i) => i.status === "SHORT"),
    hasOpenIssue: openIssueJobIds.has(row.id),
  };
}

function buildWhere(
  shopId: string,
  filters: WarehouseQueueFilters,
  currentStaffUserId: string,
  now: Date,
): Prisma.WarehousePickJobWhereInput {
  const and: Prisma.WarehousePickJobWhereInput[] = [{ shopId }];

  if (filters.statuses.length > 0) {
    and.push({ status: { in: filters.statuses as WarehousePickJobStatus[] } });
  }
  if (filters.priorities.length > 0) {
    and.push({ priority: { in: filters.priorities as Priority[] } });
  }
  if (filters.assignedStaffId) {
    and.push({ assignedStaffId: filters.assignedStaffId });
  }
  if (filters.orderNumber) {
    and.push({ order: { orderNumber: { contains: filters.orderNumber, mode: "insensitive" } } });
  }
  if (filters.customer) {
    and.push({ order: { customerName: { contains: filters.customer, mode: "insensitive" } } });
  }
  if (filters.hasIssue) {
    and.push({ issues: { some: { status: { in: [...OPEN_ISSUE_STATUSES] } } } });
  }

  switch (filters.view) {
    case "assigned_to_me":
      and.push({ assignedStaffId: currentStaffUserId });
      break;
    case "unassigned":
      and.push({ assignedStaffId: null });
      break;
    case "has_shortage":
      and.push({ items: { some: { status: "SHORT" } } });
      break;
    case "handed_over_recently":
      and.push({
        status: "HANDED_OVER",
        handedOverAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
      });
      break;
    case "all_active":
      and.push({ status: { notIn: ["HANDED_OVER", "CANCELLED"] } });
      break;
    default:
      break;
  }

  return { AND: and };
}

// Centralised warehouse-queue sort — never scatter comparison logic across
// UI components. Mirrors sortProductionQueueCards's precedence approach,
// scaled to this domain (no due dates to weigh against priority).
export function sortWarehouseQueueCards(
  cards: WarehouseQueueCard[],
  field: WarehouseQueueSortField,
): WarehouseQueueCard[] {
  const sorted = [...cards];
  switch (field) {
    case "job_age":
      sorted.sort((a, b) => b.jobAgeDays - a.jobAgeDays);
      return sorted;
    case "order_number":
      sorted.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
      return sorted;
    case "remaining_lines":
      sorted.sort((a, b) => b.remainingLineCount - a.remainingLineCount);
      return sorted;
    case "priority":
    default:
      sorted.sort((a, b) => {
        const priorityDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return b.jobAgeDays - a.jobAgeDays;
      });
      return sorted;
  }
}

export interface LoadWarehouseQueueParams {
  shopId: string;
  currentStaffUserId: string;
  filters: WarehouseQueueFilters;
  sort: WarehouseQueueSortField;
  page: number;
}

export interface WarehouseQueueResult {
  cards: WarehouseQueueCard[];
  totalCount: number;
  hasMore: boolean;
}

export async function loadWarehouseQueue(
  params: LoadWarehouseQueueParams,
): Promise<WarehouseQueueResult> {
  const now = new Date();
  const where = buildWhere(params.shopId, params.filters, params.currentStaffUserId, now);

  const totalCount = await db.warehousePickJob.count({ where });
  const rows = await db.warehousePickJob.findMany({
    where,
    select: JOB_SELECT,
    orderBy: { createdAt: "desc" },
    take: WAREHOUSE_QUEUE_PAGE_SIZE * (params.page + 1),
  });

  const staffNames = await resolveStaffNames(rows.map((r) => r.assignedStaffId));
  const openIssueJobIds = new Set(
    (
      await db.warehouseIssue.findMany({
        where: {
          warehousePickJobId: { in: rows.map((r) => r.id) },
          status: { in: [...OPEN_ISSUE_STATUSES] },
        },
        select: { warehousePickJobId: true },
      })
    ).map((i) => i.warehousePickJobId),
  );

  let cards = rows.map((row) => toCard(row, now, staffNames, openIssueJobIds));
  cards = sortWarehouseQueueCards(cards, params.sort);

  const pageStart = params.page * WAREHOUSE_QUEUE_PAGE_SIZE;
  const pageCards = cards.slice(pageStart, pageStart + WAREHOUSE_QUEUE_PAGE_SIZE);

  return {
    cards: pageCards,
    totalCount,
    hasMore: pageStart + WAREHOUSE_QUEUE_PAGE_SIZE < totalCount,
  };
}
