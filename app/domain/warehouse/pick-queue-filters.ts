// Centralised warehouse-pick-queue filter/sort vocabulary — mirrors
// production's own queue-filters.ts precedent, scaled down to this domain's
// actual field set (no due date, no decoration method on WarehousePickJob).

export const WAREHOUSE_QUEUE_VIEWS = [
  "all_active",
  "assigned_to_me",
  "unassigned",
  "has_shortage",
  "handed_over_recently",
] as const;
export type WarehouseQueueView = (typeof WAREHOUSE_QUEUE_VIEWS)[number];

export const WAREHOUSE_QUEUE_VIEW_LABELS: Record<WarehouseQueueView, string> = {
  all_active: "All active",
  assigned_to_me: "Assigned to me",
  unassigned: "Unassigned",
  has_shortage: "Has shortage",
  handed_over_recently: "Handed over recently",
};

export const WAREHOUSE_QUEUE_SORT_FIELDS = [
  "priority",
  "job_age",
  "order_number",
  "remaining_lines",
] as const;
export type WarehouseQueueSortField = (typeof WAREHOUSE_QUEUE_SORT_FIELDS)[number];

export const WAREHOUSE_QUEUE_SORT_FIELD_LABELS: Record<WarehouseQueueSortField, string> = {
  priority: "Priority",
  job_age: "Job age",
  order_number: "Order number",
  remaining_lines: "Remaining lines",
};

export const DEFAULT_WAREHOUSE_QUEUE_SORT: WarehouseQueueSortField = "priority";

export interface WarehouseQueueFilters {
  view: WarehouseQueueView | null;
  assignedStaffId: string | null;
  statuses: string[];
  priorities: string[];
  orderNumber: string | null;
  customer: string | null;
  hasIssue: boolean;
}

export const EMPTY_WAREHOUSE_QUEUE_FILTERS: WarehouseQueueFilters = {
  view: null,
  assignedStaffId: null,
  statuses: [],
  priorities: [],
  orderNumber: null,
  customer: null,
  hasIssue: false,
};

function parseListParam(searchParams: URLSearchParams, key: string): string[] {
  const raw = searchParams.get(key);
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function parseWarehouseQueueSearchParams(searchParams: URLSearchParams): {
  filters: WarehouseQueueFilters;
  sort: WarehouseQueueSortField;
} {
  const viewRaw = searchParams.get("view");
  const view = WAREHOUSE_QUEUE_VIEWS.includes(viewRaw as WarehouseQueueView)
    ? (viewRaw as WarehouseQueueView)
    : null;
  const sortRaw = searchParams.get("sort");
  const sort = WAREHOUSE_QUEUE_SORT_FIELDS.includes(sortRaw as WarehouseQueueSortField)
    ? (sortRaw as WarehouseQueueSortField)
    : DEFAULT_WAREHOUSE_QUEUE_SORT;

  return {
    filters: {
      view,
      assignedStaffId: searchParams.get("assignedStaffId"),
      statuses: parseListParam(searchParams, "status"),
      priorities: parseListParam(searchParams, "priority"),
      orderNumber: searchParams.get("orderNumber"),
      customer: searchParams.get("customer"),
      hasIssue: searchParams.get("hasIssue") === "true",
    },
    sort,
  };
}

export function warehouseQueueFiltersToSearchParams(
  filters: WarehouseQueueFilters,
  sort: WarehouseQueueSortField,
  page = 0,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.view) params.set("view", filters.view);
  if (sort !== DEFAULT_WAREHOUSE_QUEUE_SORT) params.set("sort", sort);
  if (filters.assignedStaffId) params.set("assignedStaffId", filters.assignedStaffId);
  if (filters.statuses.length) params.set("status", filters.statuses.join(","));
  if (filters.priorities.length) params.set("priority", filters.priorities.join(","));
  if (filters.orderNumber) params.set("orderNumber", filters.orderNumber);
  if (filters.customer) params.set("customer", filters.customer);
  if (filters.hasIssue) params.set("hasIssue", "true");
  if (page > 0) params.set("page", String(page));
  return params;
}

export function isWarehouseQueueFiltersEmpty(filters: WarehouseQueueFilters): boolean {
  return (
    filters.view === null &&
    filters.assignedStaffId === null &&
    filters.statuses.length === 0 &&
    filters.priorities.length === 0 &&
    filters.orderNumber === null &&
    filters.customer === null &&
    !filters.hasIssue
  );
}
