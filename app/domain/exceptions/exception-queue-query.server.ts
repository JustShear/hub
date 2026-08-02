import type { ExceptionCaseCategory, ExceptionCaseStatus, Prisma, Severity } from "@prisma/client";
import { db } from "~/lib/db.server";
import { daysSince } from "~/lib/dates";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";
import type {
  ExceptionQueueFilters,
  ExceptionQueueSortField,
} from "~/domain/exceptions/exception-queue-filters";

export const EXCEPTION_QUEUE_PAGE_SIZE = 40;

const SEVERITY_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

const CASE_SELECT = {
  id: true,
  orderId: true,
  caseNumber: true,
  category: true,
  status: true,
  severity: true,
  summary: true,
  assignedStaffId: true,
  createdAt: true,
  resolvedAt: true,
  order: { select: { orderNumber: true, customerName: true } },
} satisfies Prisma.ExceptionCaseSelect;

type CaseRow = Prisma.ExceptionCaseGetPayload<{ select: typeof CASE_SELECT }>;

export interface ExceptionQueueCard {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  caseNumber: number;
  category: ExceptionCaseCategory;
  status: ExceptionCaseStatus;
  severity: Severity;
  summary: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  caseAgeDays: number;
}

function toCard(row: CaseRow, now: Date, staffNames: Map<string, string>): ExceptionQueueCard {
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.order.orderNumber,
    customerName: row.order.customerName,
    caseNumber: row.caseNumber,
    category: row.category,
    status: row.status,
    severity: row.severity,
    summary: row.summary,
    assignedStaffId: row.assignedStaffId,
    assignedStaffName: row.assignedStaffId
      ? (staffNames.get(row.assignedStaffId) ?? "Unknown staff member")
      : null,
    caseAgeDays: daysSince(row.createdAt, now),
  };
}

function buildWhere(
  shopId: string,
  filters: ExceptionQueueFilters,
  currentStaffUserId: string,
  now: Date,
): Prisma.ExceptionCaseWhereInput {
  const and: Prisma.ExceptionCaseWhereInput[] = [{ shopId }];

  if (filters.statuses.length > 0) {
    and.push({ status: { in: filters.statuses as ExceptionCaseStatus[] } });
  }
  if (filters.categories.length > 0) {
    and.push({ category: { in: filters.categories as ExceptionCaseCategory[] } });
  }
  if (filters.severities.length > 0) {
    and.push({ severity: { in: filters.severities as Severity[] } });
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

  switch (filters.view) {
    case "assigned_to_me":
      and.push({ assignedStaffId: currentStaffUserId });
      break;
    case "unassigned":
      and.push({ assignedStaffId: null });
      break;
    case "awaiting_customer":
      and.push({ status: "AWAITING_CUSTOMER" });
      break;
    case "resolved_recently":
      and.push({
        status: "RESOLVED",
        resolvedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
      });
      break;
    case "all_open":
      and.push({ status: { notIn: ["RESOLVED", "CANCELLED"] } });
      break;
    default:
      break;
  }

  return { AND: and };
}

// Centralised exception-queue sort — never scatter comparison logic across
// UI components. Mirrors sortWarehouseQueueCards's precedence approach.
export function sortExceptionQueueCards(
  cards: ExceptionQueueCard[],
  field: ExceptionQueueSortField,
): ExceptionQueueCard[] {
  const sorted = [...cards];
  switch (field) {
    case "case_age":
      sorted.sort((a, b) => b.caseAgeDays - a.caseAgeDays);
      return sorted;
    case "order_number":
      sorted.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
      return sorted;
    case "severity":
    default:
      sorted.sort((a, b) => {
        const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (severityDiff !== 0) return severityDiff;
        return b.caseAgeDays - a.caseAgeDays;
      });
      return sorted;
  }
}

export interface LoadExceptionQueueParams {
  shopId: string;
  currentStaffUserId: string;
  filters: ExceptionQueueFilters;
  sort: ExceptionQueueSortField;
  page: number;
}

export interface ExceptionQueueResult {
  cards: ExceptionQueueCard[];
  totalCount: number;
  hasMore: boolean;
}

export async function loadExceptionQueue(
  params: LoadExceptionQueueParams,
): Promise<ExceptionQueueResult> {
  const now = new Date();
  const where = buildWhere(params.shopId, params.filters, params.currentStaffUserId, now);

  const totalCount = await db.exceptionCase.count({ where });
  const rows = await db.exceptionCase.findMany({
    where,
    select: CASE_SELECT,
    orderBy: { createdAt: "desc" },
    take: EXCEPTION_QUEUE_PAGE_SIZE * (params.page + 1),
  });

  const staffNames = await resolveStaffNames(rows.map((r) => r.assignedStaffId));

  let cards = rows.map((row) => toCard(row, now, staffNames));
  cards = sortExceptionQueueCards(cards, params.sort);

  const pageStart = params.page * EXCEPTION_QUEUE_PAGE_SIZE;
  const pageCards = cards.slice(pageStart, pageStart + EXCEPTION_QUEUE_PAGE_SIZE);

  return {
    cards: pageCards,
    totalCount,
    hasMore: pageStart + EXCEPTION_QUEUE_PAGE_SIZE < totalCount,
  };
}
