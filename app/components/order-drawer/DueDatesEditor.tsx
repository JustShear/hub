import { useState } from "react";
import { useFetcher } from "react-router";
import type { DueDateType } from "@prisma/client";
import type { OrderDetailDueDate } from "~/domain/orders/order-detail-query.server";
import { DUE_DATE_STATE_LABELS, DUE_DATE_TYPE_LABELS } from "~/domain/orders/labels";
import { formatAuDate } from "~/lib/dates";

export interface DueDatesEditorProps {
  dueDates: OrderDetailDueDate[];
  canEdit: boolean;
}

type DueDateActionResponse =
  | { intent: "setDueDate"; ok: true }
  | { intent: "setDueDate"; ok: false; error: string }
  | undefined;

const ALL_TYPES: DueDateType[] = ["INTERNAL", "CUSTOMER_PROMISED", "PRODUCTION", "DISPATCH"];

const STATE_TONE: Record<string, string> = {
  overdue: "text-error",
  due_today: "text-warning",
  due_soon: "text-warning",
  future: "text-ink",
  none: "text-muted",
};

function toInputDate(iso: string): string {
  return iso.slice(0, 10);
}

// One row per due-date type (INTERNAL/CUSTOMER_PROMISED/PRODUCTION/DISPATCH).
// Every change requires a reason (SRS: due-date edits route through the
// existing ManualOverride/CHANGE_DUE_DATE framework, which always records
// why), and is compare-and-swapped against the value the row last showed.
function DueDateRow({
  type,
  current,
  canEdit,
}: {
  type: DueDateType;
  current: OrderDetailDueDate | undefined;
  canEdit: boolean;
}) {
  const fetcher = useFetcher<DueDateActionResponse>();
  const [editing, setEditing] = useState(false);
  const [dateValue, setDateValue] = useState(current ? toInputDate(current.dueDate) : "");
  const [reason, setReason] = useState("");

  const response = fetcher.data;
  const tone = current ? (STATE_TONE[current.state] ?? "text-ink") : "text-muted";

  function startEditing() {
    setDateValue(current ? toInputDate(current.dueDate) : "");
    setReason("");
    setEditing(true);
  }

  function submit(targetDueDate: string | null) {
    void fetcher.submit(
      {
        _intent: "setDueDate",
        type,
        targetDueDate: targetDueDate ?? "",
        expectedDueDate: current?.dueDate ?? "",
        reason,
      },
      { method: "post" },
    );
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{DUE_DATE_TYPE_LABELS[type]}</span>
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={startEditing}
            className="text-xs text-brand-navy hover:underline"
          >
            {current ? "Change" : "Add"}
          </button>
        ) : null}
      </div>
      {!editing ? (
        <div className={`text-sm ${tone}`}>
          {current ? (
            <>
              {formatAuDate(current.dueDate)}{" "}
              <span className="text-xs">({DUE_DATE_STATE_LABELS[current.state]})</span>
            </>
          ) : (
            "Not set"
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded border border-border bg-page p-2">
          <input
            type="date"
            value={dateValue}
            onChange={(e) => {
              setDateValue(e.target.value);
            }}
            className="rounded border border-border px-2 py-1 text-sm"
          />
          <input
            type="text"
            placeholder="Reason (required)"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            className="rounded border border-border px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!dateValue || reason.trim().length === 0 || fetcher.state !== "idle"}
              onClick={() => {
                submit(new Date(dateValue).toISOString());
              }}
              className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
            >
              Save
            </button>
            {current ? (
              <button
                type="button"
                disabled={reason.trim().length === 0 || fetcher.state !== "idle"}
                onClick={() => {
                  submit(null);
                }}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-ink disabled:opacity-50"
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setEditing(false);
              }}
              className="rounded-md px-2.5 py-1 text-xs text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {response && !response.ok ? (
        <p role="alert" className="text-xs text-error">
          {response.error}
        </p>
      ) : null}
    </div>
  );
}

export function DueDatesEditor({ dueDates, canEdit }: DueDatesEditorProps) {
  return (
    <div>
      <h4 className="text-xs font-medium text-muted">Due dates</h4>
      <div className="mt-1">
        {ALL_TYPES.map((type) => (
          <DueDateRow
            key={type}
            type={type}
            current={dueDates.find((d) => d.type === type)}
            canEdit={canEdit}
          />
        ))}
      </div>
    </div>
  );
}
