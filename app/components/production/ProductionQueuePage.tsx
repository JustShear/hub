import { Link, useSearchParams } from "react-router";
import { AlertTriangle, Factory, X } from "lucide-react";
import { PageHeader } from "~/components/shared/PageHeader";
import { EmptyState } from "~/components/shared/EmptyState";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { PriorityBadge } from "~/components/board/CardBadges";
import {
  PRODUCTION_QUEUE_VIEWS,
  PRODUCTION_QUEUE_VIEW_LABELS,
  PRODUCTION_QUEUE_SORT_FIELDS,
  PRODUCTION_QUEUE_SORT_FIELD_LABELS,
  productionQueueFiltersToSearchParams,
  isProductionQueueFiltersEmpty,
  type ProductionQueueFilters,
  type ProductionQueueSortField,
  type ProductionQueueView,
} from "~/domain/production/queue-filters";
import {
  DECORATION_WORKSTREAM_LABELS,
  PRODUCTION_JOB_STATUS_LABELS,
} from "~/domain/production/labels";
import { PRIORITY_LABELS } from "~/domain/orders/labels";
import type {
  ProductionQueueCard,
  ProductionQueueResult,
} from "~/domain/production/queue-query.server";
import type { GenericSavedViewSummary } from "~/domain/saved-views/generic-saved-view.server";
import { GenericSavedViewsMenu } from "~/components/shared/GenericSavedViewsMenu";
import { formatAuDate } from "~/lib/dates";
import type { DecorationMethod, Priority, ProductionJobStatus } from "@prisma/client";

export interface ProductionQueuePageProps {
  filters: ProductionQueueFilters;
  sort: ProductionQueueSortField;
  page: number;
  queue: ProductionQueueResult;
  assignableStaff: { id: string; name: string }[];
  savedViews: GenericSavedViewSummary[];
  currentParams: Record<string, string>;
  currentStaffUserId: string;
  canAssign: boolean;
  canStart: boolean;
  canPause: boolean;
  canComplete: boolean;
  canReopen: boolean;
  canUpdateQuantities: boolean;
  canPerformQualityCheck: boolean;
  canCreateIssues: boolean;
  canResolveIssues: boolean;
  canCreateNotes: boolean;
}

const DECORATION_METHODS: DecorationMethod[] = [
  "EMBROIDERY",
  "DIGITAL_PRINT_DTF",
  "SCREEN_PRINT",
  "UNPRINTED",
  "OTHER",
];
const PRIORITIES: Priority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
const STATUSES: ProductionJobStatus[] = [
  "QUEUED",
  "READY",
  "IN_PROGRESS",
  "PAUSED",
  "BLOCKED",
  "AWAITING_QUALITY_CHECK",
  "COMPLETE",
  "CANCELLED",
];

const STATUS_TONE: Record<ProductionJobStatus, BadgeTone> = {
  QUEUED: "neutral",
  READY: "neutral",
  IN_PROGRESS: "neutral",
  PAUSED: "warning",
  BLOCKED: "error",
  AWAITING_QUALITY_CHECK: "warning",
  COMPLETE: "success",
  CANCELLED: "neutral",
};

const DUE_DATE_TONE: Record<ProductionQueueCard["dueDateState"], BadgeTone> = {
  overdue: "error",
  due_today: "warning",
  due_soon: "warning",
  future: "neutral",
  none: "neutral",
};

function DueDateCell({ card }: { card: ProductionQueueCard }) {
  if (!card.dueDate) return <span className="text-xs text-muted">No due date</span>;
  return <Badge tone={DUE_DATE_TONE[card.dueDateState]}>{formatAuDate(card.dueDate)}</Badge>;
}

function QueueFiltersBar({
  filters,
  sort,
  assignableStaff,
}: {
  filters: ProductionQueueFilters;
  sort: ProductionQueueSortField;
  assignableStaff: { id: string; name: string }[];
}) {
  const [, setSearchParams] = useSearchParams();

  function apply(next: ProductionQueueFilters, nextSort: ProductionQueueSortField = sort) {
    setSearchParams(productionQueueFiltersToSearchParams(next, nextSort), { replace: true });
  }

  function toggleFromList<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function reset() {
    apply({
      view: filters.view,
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
    });
  }

  const activeChips: { label: string; onRemove: () => void }[] = [
    ...filters.decorationMethods.map((m) => ({
      label: DECORATION_WORKSTREAM_LABELS[m as DecorationMethod],
      onRemove: () => {
        apply({
          ...filters,
          decorationMethods: filters.decorationMethods.filter((v) => v !== m),
        });
      },
    })),
    ...filters.statuses.map((s) => ({
      label: PRODUCTION_JOB_STATUS_LABELS[s as ProductionJobStatus],
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
    ...(filters.overdueOnly
      ? [
          {
            label: "Overdue",
            onRemove: () => {
              apply({ ...filters, overdueOnly: false });
            },
          },
        ]
      : []),
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
    ...(filters.awaitingQualityCheck
      ? [
          {
            label: "Awaiting quality check",
            onRemove: () => {
              apply({ ...filters, awaitingQualityCheck: false });
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
          <legend className="sr-only">Decoration method</legend>
          {DECORATION_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              aria-pressed={filters.decorationMethods.includes(method)}
              onClick={() => {
                apply({
                  ...filters,
                  decorationMethods: toggleFromList(filters.decorationMethods, method),
                });
              }}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy ${
                filters.decorationMethods.includes(method)
                  ? "border-brand-navy bg-accent-blue/30 text-ink"
                  : "border-border text-muted hover:text-ink"
              }`}
            >
              {DECORATION_WORKSTREAM_LABELS[method]}
            </button>
          ))}
        </fieldset>

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
                {PRODUCTION_JOB_STATUS_LABELS[status]}
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
            checked={filters.overdueOnly}
            onChange={(e) => {
              apply({ ...filters, overdueOnly: e.target.checked });
            }}
            className="h-4 w-4 rounded border-border"
          />
          Overdue
        </label>

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

        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={filters.awaitingQualityCheck}
            onChange={(e) => {
              apply({ ...filters, awaitingQualityCheck: e.target.checked });
            }}
            className="h-4 w-4 rounded border-border"
          />
          Awaiting QC
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
        <input
          type="search"
          placeholder="Product title…"
          defaultValue={filters.productTitle ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              apply({ ...filters, productTitle: e.currentTarget.value || null });
            }
          }}
          className="rounded border border-border bg-page px-2 py-1 text-xs text-ink"
        />
        <input
          type="search"
          placeholder="SKU…"
          defaultValue={filters.sku ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              apply({ ...filters, sku: e.currentTarget.value || null });
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
          {!isProductionQueueFiltersEmpty(filters) ? (
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

function JobRow({ card }: { card: ProductionQueueCard }) {
  const remaining = card.totalQuantity - card.completedQuantity;
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-page">
      <td className="p-2">
        <Link to={`/production/${card.id}`} className="font-medium text-brand-navy hover:underline">
          Job {card.jobNumber}
        </Link>
        {card.hasOpenIssue ? (
          <span title="Open issue" className="ml-1.5 inline-block align-middle text-warning">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="sr-only">Has an open issue</span>
          </span>
        ) : null}
      </td>
      <td className="p-2">
        <p className="text-ink">{card.orderNumber}</p>
        <p className="text-xs text-muted">
          {card.customerName ?? "No customer name"}
          {card.isPreorder ? " · Preorder" : ""}
        </p>
      </td>
      <td className="p-2">
        <Badge tone="neutral">{DECORATION_WORKSTREAM_LABELS[card.decorationMethod]}</Badge>
        {card.placement ? <p className="mt-0.5 text-xs text-muted">{card.placement}</p> : null}
      </td>
      <td className="p-2 text-ink">
        {card.completedQuantity} / {card.totalQuantity}
        {remaining > 0 ? <p className="text-xs text-muted">{remaining} remaining</p> : null}
      </td>
      <td className="p-2">
        <Badge tone={STATUS_TONE[card.status]}>{PRODUCTION_JOB_STATUS_LABELS[card.status]}</Badge>
      </td>
      <td className="p-2">
        <PriorityBadge priority={card.priority} />
      </td>
      <td className="p-2">
        <DueDateCell card={card} />
      </td>
      <td className="p-2 text-ink">{card.assignedStaffName ?? "Unassigned"}</td>
      <td className="p-2 text-xs text-muted">
        {card.timeInStateDays === 0 ? "Today" : `${card.timeInStateDays}d`}
      </td>
      <td className="p-2 text-xs text-muted">Batch {card.exportBatchNumber}</td>
    </tr>
  );
}

function JobCard({ card }: { card: ProductionQueueCard }) {
  const remaining = card.totalQuantity - card.completedQuantity;
  return (
    <Link
      to={`/production/${card.id}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink">
            Job {card.jobNumber}
            {card.hasOpenIssue ? (
              <span title="Open issue" className="ml-1.5 inline-block align-middle text-warning">
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </p>
          <p className="text-xs text-muted">
            {card.orderNumber} · {card.customerName ?? "No customer name"}
          </p>
        </div>
        <PriorityBadge priority={card.priority} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{DECORATION_WORKSTREAM_LABELS[card.decorationMethod]}</Badge>
        <Badge tone={STATUS_TONE[card.status]}>{PRODUCTION_JOB_STATUS_LABELS[card.status]}</Badge>
        <DueDateCell card={card} />
      </div>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {card.completedQuantity} / {card.totalQuantity}
          {remaining > 0 ? ` (${remaining} remaining)` : ""}
        </span>
        <span>{card.assignedStaffName ?? "Unassigned"}</span>
      </div>
    </Link>
  );
}

export function ProductionQueuePage({
  filters,
  sort,
  page,
  queue,
  assignableStaff,
  savedViews,
  currentParams,
}: ProductionQueuePageProps) {
  const [, setSearchParams] = useSearchParams();

  function handleViewChange(view: ProductionQueueView | null) {
    setSearchParams(productionQueueFiltersToSearchParams({ ...filters, view }, sort), {
      replace: true,
    });
  }

  function handleSortChange(field: ProductionQueueSortField) {
    setSearchParams(productionQueueFiltersToSearchParams(filters, field), { replace: true });
  }

  function loadMore() {
    setSearchParams(productionQueueFiltersToSearchParams(filters, sort, page + 1), {
      replace: true,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Production Queue"
        description="Work that has been exported for print — grouped by decoration method, one job per export batch."
        secondaryActions={
          <Link
            to="/production/report"
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
        {PRODUCTION_QUEUE_VIEWS.map((view) => (
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
            {PRODUCTION_QUEUE_VIEW_LABELS[view]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-page px-3 text-sm text-ink">
          Sort
          <select
            value={sort}
            onChange={(e) => {
              handleSortChange(e.target.value as ProductionQueueSortField);
            }}
            className="bg-transparent focus:outline-none"
          >
            {PRODUCTION_QUEUE_SORT_FIELDS.map((field) => (
              <option key={field} value={field}>
                {PRODUCTION_QUEUE_SORT_FIELD_LABELS[field]}
              </option>
            ))}
          </select>
        </label>
        <GenericSavedViewsMenu
          savedViews={savedViews}
          currentParams={currentParams}
          basePath="/production"
          actionPath="/production/actions"
        />
        <p className="text-xs text-muted">{queue.totalCount} job(s) match</p>
      </div>

      <QueueFiltersBar filters={filters} sort={sort} assignableStaff={assignableStaff} />

      {queue.cards.length === 0 ? (
        <EmptyState
          icon={Factory}
          title="No production jobs match your filters"
          description="Jobs appear here automatically once a proof group's artwork has been exported for print."
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted">
                <tr>
                  <th className="p-2 font-medium">Job</th>
                  <th className="p-2 font-medium">Order</th>
                  <th className="p-2 font-medium">Decoration</th>
                  <th className="p-2 font-medium">Quantity</th>
                  <th className="p-2 font-medium">Status</th>
                  <th className="p-2 font-medium">Priority</th>
                  <th className="p-2 font-medium">Due</th>
                  <th className="p-2 font-medium">Assigned</th>
                  <th className="p-2 font-medium">In state</th>
                  <th className="p-2 font-medium">Export</th>
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
