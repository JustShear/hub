import type { DecorationMethod, Prisma, Priority, ProductionJobStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import { classifyDueDate, daysSince } from "~/lib/dates";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";
import type {
  ProductionQueueFilters,
  ProductionQueueSortField,
} from "~/domain/production/queue-filters";

export const PRODUCTION_QUEUE_PAGE_SIZE = 40;

const OPEN_ISSUE_STATUSES = ["OPEN", "INVESTIGATING", "WAITING"] as const;

const PRIORITY_RANK: Record<Priority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 };

const JOB_SELECT = {
  id: true,
  jobNumber: true,
  orderId: true,
  decorationMethod: true,
  status: true,
  priority: true,
  dueDate: true,
  assignedStaffId: true,
  createdAt: true,
  updatedAt: true,
  exportBatch: { select: { batchNumber: true } },
  order: {
    select: { orderNumber: true, customerName: true, isPreorder: true },
  },
  tasks: {
    where: { status: { not: "CANCELLED" as const } },
    select: {
      id: true,
      placement: true,
      requiredQuantity: true,
      completedQuantity: true,
      productionArtworkId: true,
      productionArtwork: { select: { isPreviewable: true } },
    },
  },
} satisfies Prisma.ProductionJobSelect;

type JobRow = Prisma.ProductionJobGetPayload<{ select: typeof JOB_SELECT }>;

export interface ProductionQueueCard {
  id: string;
  jobNumber: number;
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  isPreorder: boolean;
  decorationMethod: DecorationMethod;
  placement: string | null;
  totalQuantity: number;
  completedQuantity: number;
  status: ProductionJobStatus;
  priority: Priority;
  dueDate: string | null;
  dueDateState: ReturnType<typeof classifyDueDate>;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  timeInStateDays: number;
  jobAgeDays: number;
  hasOpenIssue: boolean;
  exportBatchNumber: number;
  thumbnailArtworkId: string | null;
}

function toCard(
  row: JobRow,
  now: Date,
  staffNames: Map<string, string>,
  openIssueJobIds: Set<string>,
): ProductionQueueCard {
  const totalQuantity = row.tasks.reduce((sum, t) => sum + t.requiredQuantity, 0);
  const completedQuantity = row.tasks.reduce((sum, t) => sum + t.completedQuantity, 0);
  const distinctPlacements = new Set(row.tasks.map((t) => t.placement).filter(Boolean));
  const placement = distinctPlacements.size === 1 ? ([...distinctPlacements][0] ?? null) : null;
  const previewableTask = row.tasks.find((t) => t.productionArtwork.isPreviewable);

  return {
    id: row.id,
    jobNumber: row.jobNumber,
    orderId: row.orderId,
    orderNumber: row.order.orderNumber,
    customerName: row.order.customerName,
    isPreorder: row.order.isPreorder,
    decorationMethod: row.decorationMethod,
    placement,
    totalQuantity,
    completedQuantity,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate?.toISOString() ?? null,
    dueDateState: classifyDueDate(row.dueDate, now),
    assignedStaffId: row.assignedStaffId,
    assignedStaffName: row.assignedStaffId
      ? (staffNames.get(row.assignedStaffId) ?? "Unknown staff member")
      : null,
    timeInStateDays: daysSince(row.updatedAt, now),
    jobAgeDays: daysSince(row.createdAt, now),
    hasOpenIssue: openIssueJobIds.has(row.id),
    exportBatchNumber: row.exportBatch.batchNumber,
    thumbnailArtworkId: previewableTask?.productionArtworkId ?? null,
  };
}

function buildWhere(
  shopId: string,
  filters: ProductionQueueFilters,
  currentStaffUserId: string,
  now: Date,
): Prisma.ProductionJobWhereInput {
  const and: Prisma.ProductionJobWhereInput[] = [{ shopId }];

  if (filters.decorationMethods.length > 0) {
    and.push({ decorationMethod: { in: filters.decorationMethods as DecorationMethod[] } });
  }
  if (filters.statuses.length > 0) {
    and.push({ status: { in: filters.statuses as ProductionJobStatus[] } });
  }
  if (filters.priorities.length > 0) {
    and.push({ priority: { in: filters.priorities as Priority[] } });
  }
  if (filters.assignedStaffId) {
    and.push({ assignedStaffId: filters.assignedStaffId });
  }
  if (filters.dueDateFrom) {
    and.push({ dueDate: { gte: new Date(filters.dueDateFrom) } });
  }
  if (filters.dueDateTo) {
    and.push({ dueDate: { lte: new Date(filters.dueDateTo) } });
  }
  if (filters.overdueOnly) {
    and.push({ dueDate: { lt: now }, status: { notIn: ["COMPLETE", "CANCELLED"] } });
  }
  if (filters.orderNumber) {
    and.push({ order: { orderNumber: { contains: filters.orderNumber, mode: "insensitive" } } });
  }
  if (filters.customer) {
    and.push({ order: { customerName: { contains: filters.customer, mode: "insensitive" } } });
  }
  if (filters.productTitle) {
    and.push({
      tasks: {
        some: {
          productionArtwork: {
            orderLineAllocations: {
              some: {
                orderLine: {
                  productTitle: { contains: filters.productTitle, mode: "insensitive" },
                },
              },
            },
          },
        },
      },
    });
  }
  if (filters.sku) {
    and.push({
      tasks: {
        some: {
          productionArtwork: {
            orderLineAllocations: {
              some: { orderLine: { sku: { contains: filters.sku, mode: "insensitive" } } },
            },
          },
        },
      },
    });
  }
  if (filters.exportBatchId) {
    and.push({ exportBatchId: filters.exportBatchId });
  }
  if (filters.createdFrom) {
    and.push({ createdAt: { gte: new Date(filters.createdFrom) } });
  }
  if (filters.createdTo) {
    and.push({ createdAt: { lte: new Date(filters.createdTo) } });
  }
  if (filters.completedFrom) {
    and.push({ completedAt: { gte: new Date(filters.completedFrom) } });
  }
  if (filters.completedTo) {
    and.push({ completedAt: { lte: new Date(filters.completedTo) } });
  }
  if (filters.awaitingQualityCheck) {
    and.push({ status: "AWAITING_QUALITY_CHECK" });
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
    case "due_today": {
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);
      and.push({ dueDate: { gte: startOfDay, lt: endOfDay } });
      break;
    }
    case "overdue":
      and.push({ dueDate: { lt: now }, status: { notIn: ["COMPLETE", "CANCELLED"] } });
      break;
    case "urgent":
      and.push({ priority: "URGENT" });
      break;
    case "blocked":
      and.push({ status: "BLOCKED" });
      break;
    case "awaiting_quality_check":
      and.push({ status: "AWAITING_QUALITY_CHECK" });
      break;
    case "completed_recently":
      and.push({
        status: "COMPLETE",
        completedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
      });
      break;
    case "all_active":
      and.push({ status: { notIn: ["COMPLETE", "CANCELLED"] } });
      break;
    default:
      break;
  }

  return { AND: and };
}

// Centralised production-queue sort — never scatter comparison logic
// across UI components. Precedence for the "priority" default sort
// matches the milestone spec exactly: urgent -> high -> overdue -> earliest
// due date -> oldest queued work.
export function sortProductionQueueCards(
  cards: ProductionQueueCard[],
  field: ProductionQueueSortField,
): ProductionQueueCard[] {
  const sorted = [...cards];
  switch (field) {
    case "due_date":
      sorted.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
      return sorted;
    case "order_age":
      sorted.sort((a, b) => b.jobAgeDays - a.jobAgeDays);
      return sorted;
    case "job_age":
      sorted.sort((a, b) => b.jobAgeDays - a.jobAgeDays);
      return sorted;
    case "time_in_state":
      sorted.sort((a, b) => b.timeInStateDays - a.timeInStateDays);
      return sorted;
    case "order_number":
      sorted.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
      return sorted;
    case "remaining_quantity":
      sorted.sort(
        (a, b) => b.totalQuantity - b.completedQuantity - (a.totalQuantity - a.completedQuantity),
      );
      return sorted;
    case "decoration_method":
      sorted.sort((a, b) => a.decorationMethod.localeCompare(b.decorationMethod));
      return sorted;
    case "priority":
    default:
      sorted.sort((a, b) => {
        const priorityDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        const aOverdue = a.dueDateState === "overdue" ? 0 : 1;
        const bOverdue = b.dueDateState === "overdue" ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return b.jobAgeDays - a.jobAgeDays;
      });
      return sorted;
  }
}

export interface LoadProductionQueueParams {
  shopId: string;
  currentStaffUserId: string;
  filters: ProductionQueueFilters;
  sort: ProductionQueueSortField;
  page: number;
}

export interface ProductionQueueResult {
  cards: ProductionQueueCard[];
  totalCount: number;
  hasMore: boolean;
}

export async function loadProductionQueue(
  params: LoadProductionQueueParams,
): Promise<ProductionQueueResult> {
  const now = new Date();
  const where = buildWhere(params.shopId, params.filters, params.currentStaffUserId, now);

  const totalCount = await db.productionJob.count({ where });
  const rows = await db.productionJob.findMany({
    where,
    select: JOB_SELECT,
    orderBy: { createdAt: "desc" },
    take: PRODUCTION_QUEUE_PAGE_SIZE * (params.page + 1),
  });

  const staffNames = await resolveStaffNames(rows.map((r) => r.assignedStaffId));
  const openIssueJobIds = new Set(
    (
      await db.productionIssue.findMany({
        where: {
          productionJobId: { in: rows.map((r) => r.id) },
          status: { in: [...OPEN_ISSUE_STATUSES] },
        },
        select: { productionJobId: true },
      })
    ).map((i) => i.productionJobId),
  );

  let cards = rows.map((row) => toCard(row, now, staffNames, openIssueJobIds));
  cards = sortProductionQueueCards(cards, params.sort);

  const pageStart = params.page * PRODUCTION_QUEUE_PAGE_SIZE;
  const pageCards = cards.slice(pageStart, pageStart + PRODUCTION_QUEUE_PAGE_SIZE);

  return {
    cards: pageCards,
    totalCount,
    hasMore: pageStart + PRODUCTION_QUEUE_PAGE_SIZE < totalCount,
  };
}
