// Centralised exception-case-queue filter/sort vocabulary — mirrors
// production's/warehouse's own queue-filters.ts precedent, scaled to this
// domain's actual field set (category, severity, no due date/decoration
// method).

export const EXCEPTION_QUEUE_VIEWS = [
  "all_open",
  "assigned_to_me",
  "unassigned",
  "awaiting_customer",
  "resolved_recently",
] as const;
export type ExceptionQueueView = (typeof EXCEPTION_QUEUE_VIEWS)[number];

export const EXCEPTION_QUEUE_VIEW_LABELS: Record<ExceptionQueueView, string> = {
  all_open: "All open",
  assigned_to_me: "Assigned to me",
  unassigned: "Unassigned",
  awaiting_customer: "Awaiting customer",
  resolved_recently: "Resolved recently",
};

export const EXCEPTION_QUEUE_SORT_FIELDS = ["severity", "case_age", "order_number"] as const;
export type ExceptionQueueSortField = (typeof EXCEPTION_QUEUE_SORT_FIELDS)[number];

export const EXCEPTION_QUEUE_SORT_FIELD_LABELS: Record<ExceptionQueueSortField, string> = {
  severity: "Severity",
  case_age: "Case age",
  order_number: "Order number",
};

export const DEFAULT_EXCEPTION_QUEUE_SORT: ExceptionQueueSortField = "severity";

export interface ExceptionQueueFilters {
  view: ExceptionQueueView | null;
  assignedStaffId: string | null;
  statuses: string[];
  categories: string[];
  severities: string[];
  orderNumber: string | null;
  customer: string | null;
}

export const EMPTY_EXCEPTION_QUEUE_FILTERS: ExceptionQueueFilters = {
  view: null,
  assignedStaffId: null,
  statuses: [],
  categories: [],
  severities: [],
  orderNumber: null,
  customer: null,
};

function parseListParam(searchParams: URLSearchParams, key: string): string[] {
  const raw = searchParams.get(key);
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function parseExceptionQueueSearchParams(searchParams: URLSearchParams): {
  filters: ExceptionQueueFilters;
  sort: ExceptionQueueSortField;
} {
  const viewRaw = searchParams.get("view");
  const view = EXCEPTION_QUEUE_VIEWS.includes(viewRaw as ExceptionQueueView)
    ? (viewRaw as ExceptionQueueView)
    : null;
  const sortRaw = searchParams.get("sort");
  const sort = EXCEPTION_QUEUE_SORT_FIELDS.includes(sortRaw as ExceptionQueueSortField)
    ? (sortRaw as ExceptionQueueSortField)
    : DEFAULT_EXCEPTION_QUEUE_SORT;

  return {
    filters: {
      view,
      assignedStaffId: searchParams.get("assignedStaffId"),
      statuses: parseListParam(searchParams, "status"),
      categories: parseListParam(searchParams, "category"),
      severities: parseListParam(searchParams, "severity"),
      orderNumber: searchParams.get("orderNumber"),
      customer: searchParams.get("customer"),
    },
    sort,
  };
}

export function exceptionQueueFiltersToSearchParams(
  filters: ExceptionQueueFilters,
  sort: ExceptionQueueSortField,
  page = 0,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.view) params.set("view", filters.view);
  if (sort !== DEFAULT_EXCEPTION_QUEUE_SORT) params.set("sort", sort);
  if (filters.assignedStaffId) params.set("assignedStaffId", filters.assignedStaffId);
  if (filters.statuses.length) params.set("status", filters.statuses.join(","));
  if (filters.categories.length) params.set("category", filters.categories.join(","));
  if (filters.severities.length) params.set("severity", filters.severities.join(","));
  if (filters.orderNumber) params.set("orderNumber", filters.orderNumber);
  if (filters.customer) params.set("customer", filters.customer);
  if (page > 0) params.set("page", String(page));
  return params;
}

export function isExceptionQueueFiltersEmpty(filters: ExceptionQueueFilters): boolean {
  return (
    filters.view === null &&
    filters.assignedStaffId === null &&
    filters.statuses.length === 0 &&
    filters.categories.length === 0 &&
    filters.severities.length === 0 &&
    filters.orderNumber === null &&
    filters.customer === null
  );
}
