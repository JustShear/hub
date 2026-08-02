// Centralised production-queue filter/sort vocabulary — mirrors the
// Kanban board's own board-filters.ts precedent (composable filters,
// named preset views, one place the sort fields live).

export const PRODUCTION_QUEUE_VIEWS = [
  "all_active",
  "assigned_to_me",
  "unassigned",
  "due_today",
  "overdue",
  "urgent",
  "blocked",
  "awaiting_quality_check",
  "completed_recently",
] as const;
export type ProductionQueueView = (typeof PRODUCTION_QUEUE_VIEWS)[number];

export const PRODUCTION_QUEUE_VIEW_LABELS: Record<ProductionQueueView, string> = {
  all_active: "All active",
  assigned_to_me: "Assigned to me",
  unassigned: "Unassigned",
  due_today: "Due today",
  overdue: "Overdue",
  urgent: "Urgent",
  blocked: "Blocked",
  awaiting_quality_check: "Awaiting quality check",
  completed_recently: "Completed recently",
};

export const PRODUCTION_QUEUE_SORT_FIELDS = [
  "priority",
  "due_date",
  "order_age",
  "job_age",
  "time_in_state",
  "order_number",
  "remaining_quantity",
  "decoration_method",
] as const;
export type ProductionQueueSortField = (typeof PRODUCTION_QUEUE_SORT_FIELDS)[number];

export const PRODUCTION_QUEUE_SORT_FIELD_LABELS: Record<ProductionQueueSortField, string> = {
  priority: "Priority",
  due_date: "Due date",
  order_age: "Order age",
  job_age: "Production job age",
  time_in_state: "Time in state",
  order_number: "Order number",
  remaining_quantity: "Remaining quantity",
  decoration_method: "Decoration method",
};

// The one recommended default order, per the milestone spec: urgent, high
// priority, overdue, earliest due date, oldest queued work.
export const DEFAULT_PRODUCTION_QUEUE_SORT: ProductionQueueSortField = "priority";

export interface ProductionQueueFilters {
  view: ProductionQueueView | null;
  assignedStaffId: string | null;
  decorationMethods: string[];
  statuses: string[];
  priorities: string[];
  dueDateFrom: string | null;
  dueDateTo: string | null;
  overdueOnly: boolean;
  orderNumber: string | null;
  customer: string | null;
  productTitle: string | null;
  sku: string | null;
  hasIssue: boolean;
  awaitingQualityCheck: boolean;
  exportBatchId: string | null;
  createdFrom: string | null;
  createdTo: string | null;
  completedFrom: string | null;
  completedTo: string | null;
}

export const EMPTY_PRODUCTION_QUEUE_FILTERS: ProductionQueueFilters = {
  view: null,
  assignedStaffId: null,
  decorationMethods: [],
  statuses: [],
  priorities: [],
  dueDateFrom: null,
  dueDateTo: null,
  overdueOnly: false,
  orderNumber: null,
  customer: null,
  productTitle: null,
  sku: null,
  hasIssue: false,
  awaitingQualityCheck: false,
  exportBatchId: null,
  createdFrom: null,
  createdTo: null,
  completedFrom: null,
  completedTo: null,
};

function parseListParam(searchParams: URLSearchParams, key: string): string[] {
  const raw = searchParams.get(key);
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function parseProductionQueueSearchParams(searchParams: URLSearchParams): {
  filters: ProductionQueueFilters;
  sort: ProductionQueueSortField;
} {
  const viewRaw = searchParams.get("view");
  const view = PRODUCTION_QUEUE_VIEWS.includes(viewRaw as ProductionQueueView)
    ? (viewRaw as ProductionQueueView)
    : null;
  const sortRaw = searchParams.get("sort");
  const sort = PRODUCTION_QUEUE_SORT_FIELDS.includes(sortRaw as ProductionQueueSortField)
    ? (sortRaw as ProductionQueueSortField)
    : DEFAULT_PRODUCTION_QUEUE_SORT;

  return {
    filters: {
      view,
      assignedStaffId: searchParams.get("assignedStaffId"),
      decorationMethods: parseListParam(searchParams, "decorationMethod"),
      statuses: parseListParam(searchParams, "status"),
      priorities: parseListParam(searchParams, "priority"),
      dueDateFrom: searchParams.get("dueDateFrom"),
      dueDateTo: searchParams.get("dueDateTo"),
      overdueOnly: searchParams.get("overdue") === "true",
      orderNumber: searchParams.get("orderNumber"),
      customer: searchParams.get("customer"),
      productTitle: searchParams.get("productTitle"),
      sku: searchParams.get("sku"),
      hasIssue: searchParams.get("hasIssue") === "true",
      awaitingQualityCheck: searchParams.get("awaitingQualityCheck") === "true",
      exportBatchId: searchParams.get("exportBatchId"),
      createdFrom: searchParams.get("createdFrom"),
      createdTo: searchParams.get("createdTo"),
      completedFrom: searchParams.get("completedFrom"),
      completedTo: searchParams.get("completedTo"),
    },
    sort,
  };
}

// The serialisation counterpart to parseProductionQueueSearchParams — kept
// in this one file so the URL param vocabulary never has to be duplicated
// in a UI component (mirrors board-filters.ts's boardFiltersToSearchParams).
export function productionQueueFiltersToSearchParams(
  filters: ProductionQueueFilters,
  sort: ProductionQueueSortField,
  page = 0,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.view) params.set("view", filters.view);
  if (sort !== DEFAULT_PRODUCTION_QUEUE_SORT) params.set("sort", sort);
  if (filters.assignedStaffId) params.set("assignedStaffId", filters.assignedStaffId);
  if (filters.decorationMethods.length)
    params.set("decorationMethod", filters.decorationMethods.join(","));
  if (filters.statuses.length) params.set("status", filters.statuses.join(","));
  if (filters.priorities.length) params.set("priority", filters.priorities.join(","));
  if (filters.dueDateFrom) params.set("dueDateFrom", filters.dueDateFrom);
  if (filters.dueDateTo) params.set("dueDateTo", filters.dueDateTo);
  if (filters.overdueOnly) params.set("overdue", "true");
  if (filters.orderNumber) params.set("orderNumber", filters.orderNumber);
  if (filters.customer) params.set("customer", filters.customer);
  if (filters.productTitle) params.set("productTitle", filters.productTitle);
  if (filters.sku) params.set("sku", filters.sku);
  if (filters.hasIssue) params.set("hasIssue", "true");
  if (filters.awaitingQualityCheck) params.set("awaitingQualityCheck", "true");
  if (filters.exportBatchId) params.set("exportBatchId", filters.exportBatchId);
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", filters.createdTo);
  if (filters.completedFrom) params.set("completedFrom", filters.completedFrom);
  if (filters.completedTo) params.set("completedTo", filters.completedTo);
  if (page > 0) params.set("page", String(page));
  return params;
}

export function isProductionQueueFiltersEmpty(filters: ProductionQueueFilters): boolean {
  return (
    filters.view === null &&
    filters.assignedStaffId === null &&
    filters.decorationMethods.length === 0 &&
    filters.statuses.length === 0 &&
    filters.priorities.length === 0 &&
    filters.dueDateFrom === null &&
    filters.dueDateTo === null &&
    !filters.overdueOnly &&
    filters.orderNumber === null &&
    filters.customer === null &&
    filters.productTitle === null &&
    filters.sku === null &&
    !filters.hasIssue &&
    !filters.awaitingQualityCheck &&
    filters.exportBatchId === null &&
    filters.createdFrom === null &&
    filters.createdTo === null &&
    filters.completedFrom === null &&
    filters.completedTo === null
  );
}
