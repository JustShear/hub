import { useSearchParams } from "react-router";
import { X } from "lucide-react";
import {
  DUE_DATE_STATES,
  ORDER_AGE_BUCKETS,
  PRIORITY_VALUES,
  boardFiltersToSearchParams,
  isBoardFiltersEmpty,
  type BoardFilters,
  type BoardSort,
  type BoardView,
  type DueDateStateFilter,
  type OrderAgeBucket,
  type PriorityFilterValue,
} from "~/domain/orders/board-filters";
import type { BoardFilterOptions } from "~/domain/orders/board-query.server";
import { DUE_DATE_STATE_LABELS, PRIORITY_LABELS } from "~/domain/orders/labels";

export interface BoardFiltersBarProps {
  filters: BoardFilters;
  sort: BoardSort;
  view: BoardView;
  visibleColumns: string[] | undefined;
  filterOptions: BoardFilterOptions;
}

const ORDER_AGE_LABELS: Record<OrderAgeBucket, string> = {
  any: "Any age",
  over_7_days: "Over 7 days old",
  over_14_days: "Over 14 days old",
  over_30_days: "Over 30 days old",
};

// Server-driven filtering: every change replaces the URL search params,
// which re-runs orders.tsx's loader — no client-side filtering of
// already-loaded data, so filters always reflect the full matching set
// rather than just what happened to be on screen.
export function BoardFiltersBar({
  filters,
  sort,
  view,
  visibleColumns,
  filterOptions,
}: BoardFiltersBarProps) {
  const [, setSearchParams] = useSearchParams();

  function apply(next: BoardFilters) {
    setSearchParams(boardFiltersToSearchParams(next, sort, view, visibleColumns), {
      replace: true,
    });
  }

  function togglePriority(value: PriorityFilterValue) {
    const list = filters.priority.includes(value)
      ? filters.priority.filter((v) => v !== value)
      : [...filters.priority, value];
    apply({ ...filters, priority: list });
  }

  function toggleDueDateState(value: DueDateStateFilter) {
    const list = filters.dueDateStates.includes(value)
      ? filters.dueDateStates.filter((v) => v !== value)
      : [...filters.dueDateStates, value];
    apply({ ...filters, dueDateStates: list });
  }

  function toggleTag(tag: string) {
    const list = filters.tags.includes(tag)
      ? filters.tags.filter((t) => t !== tag)
      : [...filters.tags, tag];
    apply({ ...filters, tags: list });
  }

  function reset() {
    apply({
      priority: [],
      dueDateStates: [],
      tags: [],
      orderAge: "any",
      assignment: "any",
      search: filters.search,
    });
  }

  const activeChips: { label: string; onRemove: () => void }[] = [
    ...filters.priority.map((p) => ({
      label: `Priority: ${PRIORITY_LABELS[p]}`,
      onRemove: () => {
        togglePriority(p);
      },
    })),
    ...filters.dueDateStates.map((d) => ({
      label: DUE_DATE_STATE_LABELS[d],
      onRemove: () => {
        toggleDueDateState(d);
      },
    })),
    ...filters.tags.map((t) => ({
      label: `Tag: ${t}`,
      onRemove: () => {
        toggleTag(t);
      },
    })),
    ...(filters.preorder
      ? [
          {
            label: "Preorder",
            onRemove: () => {
              apply({ ...filters, preorder: undefined });
            },
          },
        ]
      : []),
    ...(filters.noProofRequired
      ? [
          {
            label: "No proof required",
            onRemove: () => {
              apply({ ...filters, noProofRequired: undefined });
            },
          },
        ]
      : []),
    ...(filters.waitingOnCustomer
      ? [
          {
            label: "Waiting on customer",
            onRemove: () => {
              apply({ ...filters, waitingOnCustomer: undefined });
            },
          },
        ]
      : []),
    ...(filters.integrationIssue
      ? [
          {
            label: "Integration issue",
            onRemove: () => {
              apply({ ...filters, integrationIssue: undefined });
            },
          },
        ]
      : []),
    ...(filters.customerResponse
      ? [
          {
            label: "Customer response",
            onRemove: () => {
              apply({ ...filters, customerResponse: undefined });
            },
          },
        ]
      : []),
    ...(filters.orderAge !== "any"
      ? [
          {
            label: ORDER_AGE_LABELS[filters.orderAge],
            onRemove: () => {
              apply({ ...filters, orderAge: "any" });
            },
          },
        ]
      : []),
    ...(filters.assignment !== "any"
      ? [
          {
            label:
              filters.assignment === "me"
                ? "Assigned to me"
                : filters.assignment === "unassigned"
                  ? "Unassigned"
                  : "Assigned staff",
            onRemove: () => {
              apply({ ...filters, assignment: "any", assignedStaffId: undefined });
            },
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-4">
        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Priority</legend>
          {PRIORITY_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.priority.includes(value)}
              onClick={() => {
                togglePriority(value);
              }}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy ${
                filters.priority.includes(value)
                  ? "border-brand-navy bg-accent-blue/30 text-ink"
                  : "border-border text-muted hover:text-ink"
              }`}
            >
              {PRIORITY_LABELS[value]}
            </button>
          ))}
        </fieldset>

        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Due date</legend>
          {DUE_DATE_STATES.filter((s) => s !== "future").map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.dueDateStates.includes(value)}
              onClick={() => {
                toggleDueDateState(value);
              }}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy ${
                filters.dueDateStates.includes(value)
                  ? "border-brand-navy bg-accent-blue/30 text-ink"
                  : "border-border text-muted hover:text-ink"
              }`}
            >
              {DUE_DATE_STATE_LABELS[value]}
            </button>
          ))}
        </fieldset>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={filters.preorder ?? false}
            onChange={(e) => {
              apply({ ...filters, preorder: e.target.checked ? true : undefined });
            }}
            className="h-4 w-4 rounded border-border"
          />
          Preorder
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={filters.noProofRequired ?? false}
            onChange={(e) => {
              apply({ ...filters, noProofRequired: e.target.checked ? true : undefined });
            }}
            className="h-4 w-4 rounded border-border"
          />
          No proof required
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={filters.waitingOnCustomer ?? false}
            onChange={(e) => {
              apply({ ...filters, waitingOnCustomer: e.target.checked ? true : undefined });
            }}
            className="h-4 w-4 rounded border-border"
          />
          Waiting on customer
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={filters.integrationIssue ?? false}
            onChange={(e) => {
              apply({ ...filters, integrationIssue: e.target.checked ? true : undefined });
            }}
            className="h-4 w-4 rounded border-border"
          />
          Integration issue
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={filters.customerResponse ?? false}
            onChange={(e) => {
              apply({ ...filters, customerResponse: e.target.checked ? true : undefined });
            }}
            className="h-4 w-4 rounded border-border"
          />
          Customer response
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          Order age
          <select
            value={filters.orderAge}
            onChange={(e) => {
              apply({ ...filters, orderAge: e.target.value as OrderAgeBucket });
            }}
            className="rounded border border-border bg-page px-1.5 py-1 text-xs text-ink"
          >
            {ORDER_AGE_BUCKETS.map((bucket) => (
              <option key={bucket} value={bucket}>
                {ORDER_AGE_LABELS[bucket]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          Assigned
          <select
            value={filters.assignment}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "staff") return; // staff picker below sets assignedStaffId directly
              apply({
                ...filters,
                assignment: value as BoardFilters["assignment"],
                assignedStaffId: undefined,
              });
            }}
            className="rounded border border-border bg-page px-1.5 py-1 text-xs text-ink"
          >
            <option value="any">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>

        {filterOptions.staff.length > 0 ? (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Staff member
            <select
              value={filters.assignment === "staff" ? (filters.assignedStaffId ?? "") : ""}
              onChange={(e) => {
                const staffId = e.target.value;
                apply(
                  staffId
                    ? { ...filters, assignment: "staff", assignedStaffId: staffId }
                    : { ...filters, assignment: "any", assignedStaffId: undefined },
                );
              }}
              className="rounded border border-border bg-page px-1.5 py-1 text-xs text-ink"
            >
              <option value="">Any</option>
              {filterOptions.staff.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {filterOptions.tags.length > 0 ? (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Tag
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) toggleTag(e.target.value);
              }}
              className="rounded border border-border bg-page px-1.5 py-1 text-xs text-ink"
            >
              <option value="">Add a tag filter…</option>
              {filterOptions.tags
                .filter((tag) => !filters.tags.includes(tag))
                .map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
      </div>

      {activeChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
          {activeChips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={chip.onRemove}
              className="flex items-center gap-1 rounded-full bg-accent-blue/30 px-2 py-0.5 text-xs text-ink hover:bg-accent-blue/50"
            >
              {chip.label}
              <X aria-hidden="true" className="h-3 w-3" />
            </button>
          ))}
          {!isBoardFiltersEmpty(filters) ? (
            <button
              type="button"
              onClick={reset}
              className="text-xs text-muted underline hover:text-ink"
            >
              Reset all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
