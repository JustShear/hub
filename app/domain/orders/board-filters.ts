import { z } from "zod";

// Shared, validated shape for board filters/sort — used to parse URL search
// params server-side AND to validate a SavedView's stored `filters`/`sortOrder`
// JSON before trusting it back (a saved view is user input, even though it's
// the user's own).

export const DUE_DATE_STATES = ["overdue", "due_today", "due_soon", "future", "none"] as const;
export type DueDateStateFilter = (typeof DUE_DATE_STATES)[number];

export const ORDER_AGE_BUCKETS = ["any", "over_7_days", "over_14_days", "over_30_days"] as const;
export type OrderAgeBucket = (typeof ORDER_AGE_BUCKETS)[number];

export const SORT_FIELDS = [
  "urgency_default",
  "priority",
  "due_date",
  "oldest_order",
  "newest_order",
  "longest_in_state",
  "order_number",
] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_FIELD_LABELS: Record<SortField, string> = {
  urgency_default: "Urgency (default)",
  priority: "Priority",
  due_date: "Nearest due date",
  oldest_order: "Oldest order",
  newest_order: "Newest order",
  longest_in_state: "Longest in current state",
  order_number: "Order number",
};

export const BOARD_VIEWS = ["board", "on_hold", "cancelled", "archived", "fulfilled"] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];

export const ASSIGNMENT_FILTERS = ["any", "me", "unassigned", "staff"] as const;
export type AssignmentFilterType = (typeof ASSIGNMENT_FILTERS)[number];

export const PRIORITY_VALUES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type PriorityFilterValue = (typeof PRIORITY_VALUES)[number];

export const boardFiltersSchema = z.object({
  priority: z.array(z.enum(PRIORITY_VALUES)).default([]),
  dueDateStates: z.array(z.enum(DUE_DATE_STATES)).default([]),
  tags: z.array(z.string().min(1)).default([]),
  preorder: z.boolean().optional(),
  noProofRequired: z.boolean().optional(),
  waitingOnCustomer: z.boolean().optional(),
  integrationIssue: z.boolean().optional(),
  customerResponse: z.boolean().optional(),
  orderAge: z.enum(ORDER_AGE_BUCKETS).default("any"),
  assignment: z.enum(ASSIGNMENT_FILTERS).default("any"),
  assignedStaffId: z.string().optional(),
  search: z.string().default(""),
});
export type BoardFilters = z.infer<typeof boardFiltersSchema>;

export const EMPTY_BOARD_FILTERS: BoardFilters = boardFiltersSchema.parse({});

export const boardSortSchema = z.object({
  field: z.enum(SORT_FIELDS).default("urgency_default"),
});
export type BoardSort = z.infer<typeof boardSortSchema>;

export const CARD_DENSITIES = ["comfortable", "compact"] as const;
export type CardDensity = (typeof CARD_DENSITIES)[number];

// Persisted in SavedView.filters (Json) — everything except sort, which has
// its own SavedView.sortOrder column (boardSortSchema, stored as-is).
// visibleColumns and density live inside this JSON bag rather than as new
// SavedView columns, since the model's filters field was already designed
// as an open JSON blob for exactly this kind of board configuration.
export const savedViewFiltersColumnSchema = z.object({
  filters: boardFiltersSchema,
  view: z.enum(BOARD_VIEWS).default("board"),
  visibleColumns: z.array(z.string()).optional(),
  density: z.enum(CARD_DENSITIES).default("comfortable"),
});
export type SavedViewFiltersColumn = z.infer<typeof savedViewFiltersColumnSchema>;

export interface SavedViewConfig {
  filters: BoardFilters;
  sort: BoardSort;
  view: BoardView;
  visibleColumns?: string[];
  density: CardDensity;
}

// Combined shape for the "create/update saved view" action's single JSON
// form field — the two SavedView columns' schemas, validated together.
export const savedViewConfigInputSchema = z.object({
  filters: boardFiltersSchema,
  sort: boardSortSchema,
  view: z.enum(BOARD_VIEWS).default("board"),
  visibleColumns: z.array(z.string()).optional(),
  density: z.enum(CARD_DENSITIES).default("comfortable"),
});

function parseListParam(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function parseBooleanParam(value: string | null): boolean | undefined {
  if (value === "1") return true;
  return undefined;
}

// Parses a request URL's search params into validated filters/sort/view —
// the one place query-string shape and BoardFilters shape are kept in sync.
export function parseBoardSearchParams(searchParams: URLSearchParams): {
  filters: BoardFilters;
  sort: BoardSort;
  view: BoardView;
  /** undefined means "show every column" — the default, and the only state that omits the URL param. */
  visibleColumns: string[] | undefined;
} {
  const rawView = searchParams.get("view");
  const view = (BOARD_VIEWS as readonly string[]).includes(rawView ?? "")
    ? (rawView as BoardView)
    : "board";

  const rawSortField = searchParams.get("sort");
  const sort = boardSortSchema.parse({
    field: (SORT_FIELDS as readonly string[]).includes(rawSortField ?? "")
      ? rawSortField
      : undefined,
  });

  const filters = boardFiltersSchema.parse({
    priority: parseListParam(searchParams.get("priority")),
    dueDateStates: parseListParam(searchParams.get("due")),
    tags: parseListParam(searchParams.get("tags")),
    preorder: parseBooleanParam(searchParams.get("preorder")),
    noProofRequired: parseBooleanParam(searchParams.get("noProof")),
    waitingOnCustomer: parseBooleanParam(searchParams.get("waiting")),
    integrationIssue: parseBooleanParam(searchParams.get("issue")),
    customerResponse: parseBooleanParam(searchParams.get("response")),
    orderAge: searchParams.get("age") ?? undefined,
    assignment: searchParams.get("assignment") ?? undefined,
    assignedStaffId: searchParams.get("assignedStaffId") ?? undefined,
    search: searchParams.get("q") ?? "",
  });

  const rawColumns = parseListParam(searchParams.get("columns"));
  const visibleColumns = rawColumns.length > 0 ? rawColumns : undefined;

  return { filters, sort, view, visibleColumns };
}

// Inverse of parseBoardSearchParams — used to build shareable/saved-view URLs.
// visibleColumns is omitted whenever undefined (the default: every column
// shown) — only a genuine subset gets written, matching every other field's
// "don't set unless non-default" convention in this function.
export function boardFiltersToSearchParams(
  filters: BoardFilters,
  sort: BoardSort,
  view: BoardView,
  visibleColumns?: string[],
): URLSearchParams {
  const params = new URLSearchParams();
  if (visibleColumns && visibleColumns.length > 0) {
    params.set("columns", visibleColumns.join(","));
  }
  if (view !== "board") params.set("view", view);
  if (sort.field !== "urgency_default") params.set("sort", sort.field);
  if (filters.priority.length) params.set("priority", filters.priority.join(","));
  if (filters.dueDateStates.length) params.set("due", filters.dueDateStates.join(","));
  if (filters.tags.length) params.set("tags", filters.tags.join(","));
  if (filters.preorder) params.set("preorder", "1");
  if (filters.noProofRequired) params.set("noProof", "1");
  if (filters.waitingOnCustomer) params.set("waiting", "1");
  if (filters.integrationIssue) params.set("issue", "1");
  if (filters.customerResponse) params.set("response", "1");
  if (filters.orderAge !== "any") params.set("age", filters.orderAge);
  if (filters.assignment !== "any") params.set("assignment", filters.assignment);
  if (filters.assignedStaffId) params.set("assignedStaffId", filters.assignedStaffId);
  if (filters.search) params.set("q", filters.search);
  return params;
}

// "due_date" and "urgency_default" need a computed field (the nearest due
// date across a related table), so they can't be a single indexed ORDER BY
// — board-query.server.ts falls back to bounded offset pagination for
// "load more" under these two sorts specifically, cursor pagination for
// everything else. The client needs to know which one to ask for.
export function usesCursorPagination(field: SortField): boolean {
  return field !== "due_date" && field !== "urgency_default";
}

export function isBoardFiltersEmpty(filters: BoardFilters): boolean {
  return (
    filters.priority.length === 0 &&
    filters.dueDateStates.length === 0 &&
    filters.tags.length === 0 &&
    !filters.preorder &&
    !filters.noProofRequired &&
    !filters.waitingOnCustomer &&
    !filters.integrationIssue &&
    !filters.customerResponse &&
    filters.orderAge === "any" &&
    filters.assignment === "any" &&
    !filters.search
  );
}
