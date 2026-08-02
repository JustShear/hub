import { useState } from "react";
import { Link, useFetcher } from "react-router";
import type { ExceptionCaseCategory, ExceptionCaseInitiator } from "@prisma/client";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { EmptyState } from "~/components/shared/EmptyState";
import {
  EXCEPTION_CASE_CATEGORY_LABELS,
  EXCEPTION_CASE_INITIATOR_LABELS,
  EXCEPTION_CASE_STATUS_LABELS,
} from "~/domain/exceptions/labels";
import { formatAuDateTime } from "~/lib/dates";
import type { OrderDetail } from "~/domain/orders/order-detail-query.server";
import type { ExceptionCaseStatus } from "@prisma/client";

export interface ExceptionsTabProps {
  order: OrderDetail;
  canCreateExceptionCases: boolean;
}

type ActionResponse =
  | { intent: string; ok: true; [key: string]: unknown }
  | { intent: string; ok: false; error: string };

const STATUS_TONE: Record<ExceptionCaseStatus, BadgeTone> = {
  OPEN: "warning",
  INVESTIGATING: "neutral",
  AWAITING_CUSTOMER: "neutral",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

const CATEGORIES: ExceptionCaseCategory[] = [
  "CUSTOMER_RETURN",
  "WARRANTY_CLAIM",
  "PRODUCTION_DEFECT",
  "OTHER",
];

function ReportProblemForm({ orderId }: { orderId: string }) {
  const fetcher = useFetcher<ActionResponse>();
  const [category, setCategory] = useState<ExceptionCaseCategory>("CUSTOMER_RETURN");
  const [initiatedBy, setInitiatedBy] = useState<ExceptionCaseInitiator>("CUSTOMER");
  const [summary, setSummary] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const response = fetcher.data;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted">
          Category
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as ExceptionCaseCategory);
            }}
            className="rounded border border-border bg-page px-2 py-1.5 text-sm text-ink"
          >
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {EXCEPTION_CASE_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted">
          Reported by
          <select
            value={initiatedBy}
            onChange={(e) => {
              setInitiatedBy(e.target.value as ExceptionCaseInitiator);
            }}
            className="rounded border border-border bg-page px-2 py-1.5 text-sm text-ink"
          >
            <option value="CUSTOMER">{EXCEPTION_CASE_INITIATOR_LABELS.CUSTOMER}</option>
            <option value="STAFF">{EXCEPTION_CASE_INITIATOR_LABELS.STAFF}</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Summary (required)
        <input
          type="text"
          value={summary}
          onChange={(e) => {
            setSummary(e.target.value);
          }}
          className="rounded border border-border px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        What the customer said (optional)
        <textarea
          value={customerNote}
          onChange={(e) => {
            setCustomerNote(e.target.value);
          }}
          rows={2}
          className="rounded border border-border px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="button"
        disabled={summary.trim().length === 0 || fetcher.state !== "idle"}
        onClick={() => {
          const formData = new FormData();
          formData.set("_intent", "createExceptionCase");
          formData.set("orderId", orderId);
          formData.set("category", category);
          formData.set("initiatedBy", initiatedBy);
          formData.set("summary", summary);
          formData.set("customerNote", customerNote);
          void fetcher.submit(formData, { method: "post", action: "/exceptions/actions" });
          setSummary("");
          setCustomerNote("");
        }}
        className="self-start rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        Report a problem
      </button>
      {response && !response.ok ? (
        <p role="alert" className="text-xs text-error">
          {response.error}
        </p>
      ) : null}
    </div>
  );
}

export function ExceptionsTab({ order, canCreateExceptionCases }: ExceptionsTabProps) {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="text-sm font-semibold text-ink">Exceptions</h3>
        <p className="mt-0.5 text-xs text-muted">
          Returns, warranty claims, and production defects for this order — independent of where the
          order sits in production or fulfilment. Open the full workstation to investigate and
          record a resolution.
        </p>
      </section>

      {order.exceptionCases.length === 0 ? (
        <EmptyState
          title="No exception cases"
          description="Nothing has gone wrong with this order yet."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {order.exceptionCases.map((exceptionCase) => (
            <Link
              key={exceptionCase.id}
              to={`/exceptions/${exceptionCase.id}`}
              className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3 text-sm hover:bg-page"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">Case {exceptionCase.caseNumber}</span>
                <Badge tone={STATUS_TONE[exceptionCase.status]}>
                  {EXCEPTION_CASE_STATUS_LABELS[exceptionCase.status]}
                </Badge>
                <Badge tone="neutral">
                  {EXCEPTION_CASE_CATEGORY_LABELS[exceptionCase.category]}
                </Badge>
              </div>
              <p className="text-ink">{exceptionCase.summary}</p>
              <p className="text-xs text-muted">
                {exceptionCase.assignedStaffName
                  ? `Assigned: ${exceptionCase.assignedStaffName}`
                  : "Unassigned"}{" "}
                · Reported {formatAuDateTime(exceptionCase.createdAt)}
              </p>
            </Link>
          ))}
        </div>
      )}

      {canCreateExceptionCases ? <ReportProblemForm orderId={order.id} /> : null}
    </div>
  );
}
