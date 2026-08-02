import { Link, useSearchParams } from "react-router";
import { AlertOctagon, X } from "lucide-react";
import { PageHeader } from "~/components/shared/PageHeader";
import { EmptyState } from "~/components/shared/EmptyState";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import {
  EXCEPTION_QUEUE_VIEWS,
  EXCEPTION_QUEUE_VIEW_LABELS,
  EXCEPTION_QUEUE_SORT_FIELDS,
  EXCEPTION_QUEUE_SORT_FIELD_LABELS,
  exceptionQueueFiltersToSearchParams,
  isExceptionQueueFiltersEmpty,
  type ExceptionQueueFilters,
  type ExceptionQueueSortField,
  type ExceptionQueueView,
} from "~/domain/exceptions/exception-queue-filters";
import {
  EXCEPTION_CASE_CATEGORY_LABELS,
  EXCEPTION_CASE_STATUS_LABELS,
} from "~/domain/exceptions/labels";
import type {
  ExceptionQueueCard,
  ExceptionQueueResult,
} from "~/domain/exceptions/exception-queue-query.server";
import type { GenericSavedViewSummary } from "~/domain/saved-views/generic-saved-view.server";
import { GenericSavedViewsMenu } from "~/components/shared/GenericSavedViewsMenu";
import type { ExceptionCaseCategory, ExceptionCaseStatus, Severity } from "@prisma/client";

export interface ExceptionQueuePageProps {
  filters: ExceptionQueueFilters;
  sort: ExceptionQueueSortField;
  page: number;
  queue: ExceptionQueueResult;
  assignableStaff: { id: string; name: string }[];
  savedViews: GenericSavedViewSummary[];
  currentParams: Record<string, string>;
}

const SEVERITIES: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const CATEGORIES: ExceptionCaseCategory[] = [
  "CUSTOMER_RETURN",
  "WARRANTY_CLAIM",
  "PRODUCTION_DEFECT",
  "OTHER",
];
const STATUSES: ExceptionCaseStatus[] = [
  "OPEN",
  "INVESTIGATING",
  "AWAITING_CUSTOMER",
  "RESOLVED",
  "CANCELLED",
];

const STATUS_TONE: Record<ExceptionCaseStatus, BadgeTone> = {
  OPEN: "warning",
  INVESTIGATING: "neutral",
  AWAITING_CUSTOMER: "neutral",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

const SEVERITY_TONE: Record<Severity, BadgeTone> = {
  LOW: "neutral",
  MEDIUM: "neutral",
  HIGH: "warning",
  CRITICAL: "error",
};

function QueueFiltersBar({
  filters,
  sort,
  assignableStaff,
}: {
  filters: ExceptionQueueFilters;
  sort: ExceptionQueueSortField;
  assignableStaff: { id: string; name: string }[];
}) {
  const [, setSearchParams] = useSearchParams();

  function apply(next: ExceptionQueueFilters, nextSort: ExceptionQueueSortField = sort) {
    setSearchParams(exceptionQueueFiltersToSearchParams(next, nextSort), { replace: true });
  }

  function toggleFromList<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function reset() {
    apply({
      view: filters.view,
      assignedStaffId: null,
      statuses: [],
      categories: [],
      severities: [],
      orderNumber: null,
      customer: null,
    });
  }

  const activeChips: { label: string; onRemove: () => void }[] = [
    ...filters.statuses.map((s) => ({
      label: EXCEPTION_CASE_STATUS_LABELS[s as ExceptionCaseStatus],
      onRemove: () => {
        apply({ ...filters, statuses: filters.statuses.filter((v) => v !== s) });
      },
    })),
    ...filters.categories.map((c) => ({
      label: EXCEPTION_CASE_CATEGORY_LABELS[c as ExceptionCaseCategory],
      onRemove: () => {
        apply({ ...filters, categories: filters.categories.filter((v) => v !== c) });
      },
    })),
    ...filters.severities.map((s) => ({
      label: s,
      onRemove: () => {
        apply({ ...filters, severities: filters.severities.filter((v) => v !== s) });
      },
    })),
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
          <legend className="sr-only">Severity</legend>
          {SEVERITIES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.severities.includes(value)}
              onClick={() => {
                apply({ ...filters, severities: toggleFromList(filters.severities, value) });
              }}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy ${
                filters.severities.includes(value)
                  ? "border-brand-navy bg-accent-blue/30 text-ink"
                  : "border-border text-muted hover:text-ink"
              }`}
            >
              {value}
            </button>
          ))}
        </fieldset>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          Category
          <select
            multiple
            value={filters.categories}
            onChange={(e) => {
              const values = Array.from(e.target.selectedOptions, (o) => o.value);
              apply({ ...filters, categories: values });
            }}
            className="rounded border border-border bg-page px-1.5 py-1 text-xs text-ink"
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {EXCEPTION_CASE_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </label>

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
                {EXCEPTION_CASE_STATUS_LABELS[status]}
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
          {!isExceptionQueueFiltersEmpty(filters) ? (
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

function CaseRow({ card }: { card: ExceptionQueueCard }) {
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-page">
      <td className="p-2">
        <Link to={`/exceptions/${card.id}`} className="font-medium text-brand-navy hover:underline">
          {card.orderNumber} — Case {card.caseNumber}
        </Link>
        <p className="max-w-xs truncate text-xs text-muted">{card.summary}</p>
      </td>
      <td className="p-2 text-ink">{EXCEPTION_CASE_CATEGORY_LABELS[card.category]}</td>
      <td className="p-2">
        <Badge tone={STATUS_TONE[card.status]}>{EXCEPTION_CASE_STATUS_LABELS[card.status]}</Badge>
      </td>
      <td className="p-2">
        <Badge tone={SEVERITY_TONE[card.severity]}>{card.severity}</Badge>
      </td>
      <td className="p-2 text-ink">{card.assignedStaffName ?? "Unassigned"}</td>
      <td className="p-2 text-xs text-muted">
        {card.caseAgeDays === 0 ? "Today" : `${card.caseAgeDays}d`}
      </td>
    </tr>
  );
}

function CaseCard({ card }: { card: ExceptionQueueCard }) {
  return (
    <Link
      to={`/exceptions/${card.id}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink">
            {card.orderNumber} — Case {card.caseNumber}
          </p>
          <p className="text-xs text-muted">{card.summary}</p>
        </div>
        <Badge tone={SEVERITY_TONE[card.severity]}>{card.severity}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_TONE[card.status]}>{EXCEPTION_CASE_STATUS_LABELS[card.status]}</Badge>
        <Badge tone="neutral">{EXCEPTION_CASE_CATEGORY_LABELS[card.category]}</Badge>
      </div>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{card.assignedStaffName ?? "Unassigned"}</span>
        <span>{card.caseAgeDays === 0 ? "Today" : `${card.caseAgeDays}d`}</span>
      </div>
    </Link>
  );
}

export function ExceptionQueuePage({
  filters,
  sort,
  page,
  queue,
  assignableStaff,
  savedViews,
  currentParams,
}: ExceptionQueuePageProps) {
  const [, setSearchParams] = useSearchParams();

  function handleViewChange(view: ExceptionQueueView | null) {
    setSearchParams(exceptionQueueFiltersToSearchParams({ ...filters, view }, sort), {
      replace: true,
    });
  }

  function handleSortChange(field: ExceptionQueueSortField) {
    setSearchParams(exceptionQueueFiltersToSearchParams(filters, field), { replace: true });
  }

  function loadMore() {
    setSearchParams(exceptionQueueFiltersToSearchParams(filters, sort, page + 1), {
      replace: true,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Exceptions"
        description="Returns, warranty claims, and production defects — everything that happens when something goes wrong after an order."
        secondaryActions={
          <Link
            to="/exceptions/report"
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
        {EXCEPTION_QUEUE_VIEWS.map((view) => (
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
            {EXCEPTION_QUEUE_VIEW_LABELS[view]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-page px-3 text-sm text-ink">
          Sort
          <select
            value={sort}
            onChange={(e) => {
              handleSortChange(e.target.value as ExceptionQueueSortField);
            }}
            className="bg-transparent focus:outline-none"
          >
            {EXCEPTION_QUEUE_SORT_FIELDS.map((field) => (
              <option key={field} value={field}>
                {EXCEPTION_QUEUE_SORT_FIELD_LABELS[field]}
              </option>
            ))}
          </select>
        </label>
        <GenericSavedViewsMenu
          savedViews={savedViews}
          currentParams={currentParams}
          basePath="/exceptions"
          actionPath="/exceptions/actions"
        />
        <p className="text-xs text-muted">{queue.totalCount} case(s) match</p>
      </div>

      <QueueFiltersBar filters={filters} sort={sort} assignableStaff={assignableStaff} />

      {queue.cards.length === 0 ? (
        <EmptyState
          icon={AlertOctagon}
          title="No exception cases match your filters"
          description="Report a problem from an order's Exceptions tab to get started."
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted">
                <tr>
                  <th className="p-2 font-medium">Case</th>
                  <th className="p-2 font-medium">Category</th>
                  <th className="p-2 font-medium">Status</th>
                  <th className="p-2 font-medium">Severity</th>
                  <th className="p-2 font-medium">Assigned</th>
                  <th className="p-2 font-medium">Age</th>
                </tr>
              </thead>
              <tbody>
                {queue.cards.map((card) => (
                  <CaseRow key={card.id} card={card} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 sm:hidden">
            {queue.cards.map((card) => (
              <CaseCard key={card.id} card={card} />
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
