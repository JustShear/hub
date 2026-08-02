import { Link, useSearchParams } from "react-router";
import { AlertTriangle, PackageSearch, X } from "lucide-react";
import { PageHeader } from "~/components/shared/PageHeader";
import { EmptyState } from "~/components/shared/EmptyState";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { PriorityBadge } from "~/components/board/CardBadges";
import {
  WAREHOUSE_QUEUE_VIEWS,
  WAREHOUSE_QUEUE_VIEW_LABELS,
  WAREHOUSE_QUEUE_SORT_FIELDS,
  WAREHOUSE_QUEUE_SORT_FIELD_LABELS,
  warehouseQueueFiltersToSearchParams,
  isWarehouseQueueFiltersEmpty,
  type WarehouseQueueFilters,
  type WarehouseQueueSortField,
  type WarehouseQueueView,
} from "~/domain/warehouse/pick-queue-filters";
import { WAREHOUSE_PICK_JOB_STATUS_LABELS } from "~/domain/warehouse/labels";
import { PRIORITY_LABELS } from "~/domain/orders/labels";
import type {
  WarehouseQueueCard,
  WarehouseQueueResult,
} from "~/domain/warehouse/pick-queue-query.server";
import type { GenericSavedViewSummary } from "~/domain/saved-views/generic-saved-view.server";
import { GenericSavedViewsMenu } from "~/components/shared/GenericSavedViewsMenu";
import type { Priority, WarehousePickJobStatus } from "@prisma/client";

export interface WarehousePickQueuePageProps {
  filters: WarehouseQueueFilters;
  sort: WarehouseQueueSortField;
  page: number;
  queue: WarehouseQueueResult;
  assignableStaff: { id: string; name: string }[];
  savedViews: GenericSavedViewSummary[];
  currentParams: Record<string, string>;
}

const PRIORITIES: Priority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
const STATUSES: WarehousePickJobStatus[] = ["QUEUED", "IN_PROGRESS", "HANDED_OVER", "CANCELLED"];

const STATUS_TONE: Record<WarehousePickJobStatus, BadgeTone> = {
  QUEUED: "neutral",
  IN_PROGRESS: "neutral",
  HANDED_OVER: "success",
  CANCELLED: "neutral",
};

function QueueFiltersBar({
  filters,
  sort,
  assignableStaff,
}: {
  filters: WarehouseQueueFilters;
  sort: WarehouseQueueSortField;
  assignableStaff: { id: string; name: string }[];
}) {
  const [, setSearchParams] = useSearchParams();

  function apply(next: WarehouseQueueFilters, nextSort: WarehouseQueueSortField = sort) {
    setSearchParams(warehouseQueueFiltersToSearchParams(next, nextSort), { replace: true });
  }

  function toggleFromList<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function reset() {
    apply({
      view: filters.view,
      assignedStaffId: null,
      statuses: [],
      priorities: [],
      orderNumber: null,
      customer: null,
      hasIssue: false,
    });
  }

  const activeChips: { label: string; onRemove: () => void }[] = [
    ...filters.statuses.map((s) => ({
      label: WAREHOUSE_PICK_JOB_STATUS_LABELS[s as WarehousePickJobStatus],
      onRemove: () => {
        apply({ ...filters, statuses: filters.statuses.filter((v) => v !== s) });
      },
    })),
    ...filters.priorities.map((p) => ({
      label: PRIORITY_LABELS[p as Priority],
      onRemove: () => {
        apply({ ...filters, priorities: filters.priorities.filter((v) => v !== p) });
      },
    })),
    ...(filters.hasIssue
      ? [
          {
            label: "Has open issue",
            onRemove: () => {
              apply({ ...filters, hasIssue: false });
            },
          },
        ]
      : []),
    ...(filters.assignedStaffId
      ? [
          {
            label: `Staff: ${assignableStaff.find((s) => s.id === filters.assignedStaffId)?.name ?? "Unknown"}`,
            onRemove: () => {
              apply({ ...filters, assignedStaffId: null });
            },
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-4">
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Priority</legend>
          {PRIORITIES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.priorities.includes(value)}
              onClick={() => {
                apply({ ...filters, priorities: toggleFromList(filters.priorities, value) });
              }}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy ${
                filters.priorities.includes(value)
                  ? "border-brand-navy bg-accent-blue/30 text-ink"
                  : "border-border text-muted hover:text-ink"
              }`}
            >
              {PRIORITY_LABELS[value]}
            </button>
          ))}
        </fieldset>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          Status
          <select
            multiple
            value={filters.statuses}
            onChange={(e) => {
              const values = Array.from(e.target.selectedOptions, (o) => o.value);
              apply({ ...filters, statuses: values });
            }}
            className="rounded border border-border bg-page px-1.5 py-1 text-xs text-ink"
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {WAREHOUSE_PICK_JOB_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        {assignableStaff.length > 0 ? (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Assigned
            <select
              value={filters.assignedStaffId ?? ""}
              onChange={(e) => {
                apply({ ...filters, assignedStaffId: e.target.value || null });
              }}
              className="rounded border border-border bg-page px-1.5 py-1 text-xs text-ink"
            >
              <option value="">Anyone</option>
              {assignableStaff.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={filters.hasIssue}
            onChange={(e) => {
              apply({ ...filters, hasIssue: e.target.checked });
            }}
            className="h-4 w-4 rounded border-border"
          />
          Has open issue
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Order number…"
          defaultValue={filters.orderNumber ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              apply({ ...filters, orderNumber: e.currentTarget.value || null });
            }
          }}
          className="rounded border border-border bg-page px-2 py-1 text-xs text-ink"
        />
        <input
          type="search"
          placeholder="Customer…"
          defaultValue={filters.customer ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              apply({ ...filters, customer: e.currentTarget.value || null });
            }
          }}
          className="rounded border border-border bg-page px-2 py-1 text-xs text-ink"
        />
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
          {!isWarehouseQueueFiltersEmpty(filters) ? (
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

function JobRow({ card }: { card: WarehouseQueueCard }) {
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-page">
      <td className="p-2">
        <Link to={`/warehouse/${card.id}`} className="font-medium text-brand-navy hover:underline">
          {card.orderNumber}
        </Link>
        {card.hasOpenIssue ? (
          <span title="Open issue" className="ml-1.5 inline-block align-middle text-warning">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="sr-only">Has an open issue</span>
          </span>
        ) : null}
        <p className="text-xs text-muted">{card.customerName ?? "No customer name"}</p>
      </td>
      <td className="p-2 text-ink">
        {card.pickedLineCount} / {card.lineCount} lines
        {card.remainingLineCount > 0 ? (
          <p className="text-xs text-muted">{card.remainingLineCount} remaining</p>
        ) : null}
        {card.hasShortItem ? <p className="text-xs text-warning">Has a short line</p> : null}
      </td>
      <td className="p-2">
        <Badge tone={STATUS_TONE[card.status]}>
          {WAREHOUSE_PICK_JOB_STATUS_LABELS[card.status]}
        </Badge>
      </td>
      <td className="p-2">
        <PriorityBadge priority={card.priority} />
      </td>
      <td className="p-2 text-ink">{card.assignedStaffName ?? "Unassigned"}</td>
      <td className="p-2 text-xs text-muted">
        {card.jobAgeDays === 0 ? "Today" : `${card.jobAgeDays}d`}
      </td>
    </tr>
  );
}

function JobCard({ card }: { card: WarehouseQueueCard }) {
  return (
    <Link
      to={`/warehouse/${card.id}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink">
            {card.orderNumber}
            {card.hasOpenIssue ? (
              <span title="Open issue" className="ml-1.5 inline-block align-middle text-warning">
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </p>
          <p className="text-xs text-muted">{card.customerName ?? "No customer name"}</p>
        </div>
        <PriorityBadge priority={card.priority} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_TONE[card.status]}>
          {WAREHOUSE_PICK_JOB_STATUS_LABELS[card.status]}
        </Badge>
        {card.hasShortItem ? <Badge tone="warning">Short</Badge> : null}
      </div>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {card.pickedLineCount} / {card.lineCount} lines
          {card.remainingLineCount > 0 ? ` (${card.remainingLineCount} remaining)` : ""}
        </span>
        <span>{card.assignedStaffName ?? "Unassigned"}</span>
      </div>
    </Link>
  );
}

export function WarehousePickQueuePage({
  filters,
  sort,
  page,
  queue,
  assignableStaff,
  savedViews,
  currentParams,
}: WarehousePickQueuePageProps) {
  const [, setSearchParams] = useSearchParams();

  function handleViewChange(view: WarehouseQueueView | null) {
    setSearchParams(warehouseQueueFiltersToSearchParams({ ...filters, view }, sort), {
      replace: true,
    });
  }

  function handleSortChange(field: WarehouseQueueSortField) {
    setSearchParams(warehouseQueueFiltersToSearchParams(filters, field), { replace: true });
  }

  function loadMore() {
    setSearchParams(warehouseQueueFiltersToSearchParams(filters, sort, page + 1), {
      replace: true,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Warehouse Picking"
        description="Orders ready to be physically gathered once production is complete — one pick job per order, one line per order item."
        secondaryActions={
          <Link
            to="/warehouse/report"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:bg-page"
          >
            Reporting
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        <button
          type="button"
          aria-current={filters.view === null ? "page" : undefined}
          onClick={() => {
            handleViewChange(null);
          }}
          className={`rounded-t-md border-b-2 px-3 py-1.5 text-sm font-medium ${
            filters.view === null
              ? "border-brand-navy text-ink"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          All
        </button>
        {WAREHOUSE_QUEUE_VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            aria-current={filters.view === view ? "page" : undefined}
            onClick={() => {
              handleViewChange(view);
            }}
            className={`rounded-t-md border-b-2 px-3 py-1.5 text-sm font-medium ${
              filters.view === view
                ? "border-brand-navy text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {WAREHOUSE_QUEUE_VIEW_LABELS[view]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-page px-3 text-sm text-ink">
          Sort
          <select
            value={sort}
            onChange={(e) => {
              handleSortChange(e.target.value as WarehouseQueueSortField);
            }}
            className="bg-transparent focus:outline-none"
          >
            {WAREHOUSE_QUEUE_SORT_FIELDS.map((field) => (
              <option key={field} value={field}>
                {WAREHOUSE_QUEUE_SORT_FIELD_LABELS[field]}
              </option>
            ))}
          </select>
        </label>
        <GenericSavedViewsMenu
          savedViews={savedViews}
          currentParams={currentParams}
          basePath="/warehouse"
          actionPath="/warehouse/actions"
        />
        <p className="text-xs text-muted">{queue.totalCount} job(s) match</p>
      </div>

      <QueueFiltersBar filters={filters} sort={sort} assignableStaff={assignableStaff} />

      {queue.cards.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No warehouse pick jobs match your filters"
          description="Jobs appear here automatically once an order's production is complete."
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted">
                <tr>
                  <th className="p-2 font-medium">Order</th>
                  <th className="p-2 font-medium">Lines</th>
                  <th className="p-2 font-medium">Status</th>
                  <th className="p-2 font-medium">Priority</th>
                  <th className="p-2 font-medium">Assigned</th>
                  <th className="p-2 font-medium">Age</th>
                </tr>
              </thead>
              <tbody>
                {queue.cards.map((card) => (
                  <JobRow key={card.id} card={card} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 sm:hidden">
            {queue.cards.map((card) => (
              <JobCard key={card.id} card={card} />
            ))}
          </div>
        </>
      )}

      {queue.hasMore ? (
        <button
          type="button"
          onClick={loadMore}
          className="self-center rounded-md border border-border bg-surface px-4 py-2 text-sm text-ink hover:bg-page"
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}
