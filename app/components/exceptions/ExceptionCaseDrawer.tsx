import { useState } from "react";
import { useFetcher, useLocation, useNavigate } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import type { ExceptionResolutionType } from "@prisma/client";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { EmptyState } from "~/components/shared/EmptyState";
import {
  EXCEPTION_CASE_CATEGORY_LABELS,
  EXCEPTION_CASE_STATUS_LABELS,
  EXCEPTION_RESOLUTION_STATUS_LABELS,
  EXCEPTION_RESOLUTION_TYPE_LABELS,
} from "~/domain/exceptions/labels";
import { formatAuDateTime } from "~/lib/dates";
import type { ExceptionCaseDetail } from "~/domain/exceptions/exception-case-detail-query.server";
import type { ExceptionCaseStatus } from "@prisma/client";

type ActionResponse =
  | { intent: string; ok: true; [key: string]: unknown }
  | { intent: string; ok: false; error: string; issues?: string[] };

export interface ExceptionCaseDrawerProps {
  detail: ExceptionCaseDetail;
  assignableStaff: { id: string; name: string }[];
  canUpdate: boolean;
  canAssign: boolean;
  canResolve: boolean;
  canCancel: boolean;
  canCreateNotes: boolean;
}

const STATUS_TONE: Record<ExceptionCaseStatus, BadgeTone> = {
  OPEN: "warning",
  INVESTIGATING: "neutral",
  AWAITING_CUSTOMER: "neutral",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

const RESOLUTION_TYPES: ExceptionResolutionType[] = [
  "REPRINT",
  "CREDIT",
  "REFUND",
  "EXCHANGE",
  "DENIED",
];

function actorLabel(
  event: ExceptionCaseDetail["activity"][number],
  staffNames: Record<string, string>,
): string {
  if (event.actorType === "SYSTEM") return "System";
  if (event.actorType === "CUSTOMER") return "Customer";
  return event.actorStaffId
    ? (staffNames[event.actorStaffId] ?? "Unknown staff member")
    : "Unknown staff member";
}

function ReturnLabelForm({ actionUrl, caseId }: { actionUrl: string; caseId: string }) {
  const fetcher = useFetcher<ActionResponse>();
  const [note, setNote] = useState("");

  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-page p-2">
      <input
        type="text"
        placeholder="Carrier, tracking number, etc. (required)"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        className="rounded border border-border px-2 py-1 text-sm"
      />
      <button
        type="button"
        disabled={note.trim().length === 0 || fetcher.state !== "idle"}
        onClick={() => {
          const formData = new FormData();
          formData.set("_intent", "recordReturnLabel");
          formData.set("exceptionCaseId", caseId);
          formData.set("note", note);
          void fetcher.submit(formData, { method: "post", action: actionUrl });
          setNote("");
        }}
        className="self-start rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
      >
        Record return label
      </button>
      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="text-xs text-error">
          {fetcher.data.error}
        </p>
      ) : null}
    </div>
  );
}

function ResolutionForm({
  actionUrl,
  caseId,
  proofGroups,
}: {
  actionUrl: string;
  caseId: string;
  proofGroups: ExceptionCaseDetail["proofGroups"];
}) {
  const fetcher = useFetcher<ActionResponse>();
  const [resolutionType, setResolutionType] = useState<ExceptionResolutionType>("DENIED");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [proofGroupId, setProofGroupId] = useState("");
  const needsAmount = resolutionType === "CREDIT" || resolutionType === "REFUND";
  const needsProofGroup = resolutionType === "REPRINT" || resolutionType === "EXCHANGE";
  const canSubmit =
    reason.trim().length > 0 &&
    (!needsAmount || Number(amount) > 0) &&
    (!needsProofGroup || proofGroupId.length > 0);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Resolution
        <select
          value={resolutionType}
          onChange={(e) => {
            setResolutionType(e.target.value as ExceptionResolutionType);
          }}
          className="rounded border border-border bg-page px-2 py-1.5 text-sm text-ink"
        >
          {RESOLUTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {EXCEPTION_RESOLUTION_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      {needsAmount ? (
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Amount — record-only, staff process the actual refund/credit in Shopify
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            className="rounded border border-border px-2 py-1.5 text-sm"
          />
        </label>
      ) : null}
      {needsProofGroup ? (
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Proof group being {resolutionType === "REPRINT" ? "reprinted" : "exchanged"}
          <select
            value={proofGroupId}
            onChange={(e) => {
              setProofGroupId(e.target.value);
            }}
            className="rounded border border-border bg-page px-2 py-1.5 text-sm text-ink"
          >
            <option value="">Select a proof group…</option>
            {proofGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Reason (required)
        <textarea
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
          rows={2}
          className="rounded border border-border px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="button"
        disabled={!canSubmit || fetcher.state !== "idle"}
        onClick={() => {
          const formData = new FormData();
          formData.set("_intent", "resolveExceptionCase");
          formData.set("exceptionCaseId", caseId);
          formData.set("resolutionType", resolutionType);
          formData.set("reason", reason);
          if (needsAmount) formData.set("amount", amount);
          if (needsProofGroup) formData.set("proofGroupId", proofGroupId);
          void fetcher.submit(formData, { method: "post", action: actionUrl });
        }}
        className="self-start rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        Record resolution
      </button>
      {fetcher.data && !fetcher.data.ok ? (
        <div>
          <p role="alert" className="text-xs text-error">
            {fetcher.data.error}
          </p>
          {fetcher.data.issues ? (
            <ul className="list-disc pl-4 text-xs text-error">
              {fetcher.data.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MarkCompletedButton({
  actionUrl,
  resolutionId,
}: {
  actionUrl: string;
  resolutionId: string;
}) {
  const fetcher = useFetcher<ActionResponse>();
  return (
    <button
      type="button"
      disabled={fetcher.state !== "idle"}
      onClick={() => {
        const formData = new FormData();
        formData.set("_intent", "markResolutionCompleted");
        formData.set("resolutionId", resolutionId);
        void fetcher.submit(formData, { method: "post", action: actionUrl });
      }}
      className="rounded-md border border-border px-2.5 py-1 text-xs text-ink hover:bg-page disabled:opacity-50"
    >
      Mark completed
    </button>
  );
}

function CaseNoteForm({ actionUrl, caseId }: { actionUrl: string; caseId: string }) {
  const fetcher = useFetcher<ActionResponse>();
  const [body, setBody] = useState("");
  return (
    <div className="mt-2 flex gap-2">
      <input
        type="text"
        placeholder="Add an internal note…"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
        }}
        className="flex-1 rounded border border-border px-2 py-1 text-sm"
      />
      <button
        type="button"
        disabled={body.trim().length === 0 || fetcher.state !== "idle"}
        onClick={() => {
          const formData = new FormData();
          formData.set("_intent", "addExceptionCaseNote");
          formData.set("exceptionCaseId", caseId);
          formData.set("body", body);
          void fetcher.submit(formData, { method: "post", action: actionUrl });
          setBody("");
        }}
        className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
      >
        Add
      </button>
    </div>
  );
}

function CancelCaseSection({ actionUrl, caseId }: { actionUrl: string; caseId: string }) {
  const fetcher = useFetcher<ActionResponse>();
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => {
          setShowForm(true);
        }}
        className="self-start text-xs text-error hover:underline"
      >
        Cancel this case
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded border border-error/40 bg-error/5 p-2">
      <input
        type="text"
        placeholder="Reason for cancelling (required)"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
        className="rounded border border-border px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={reason.trim().length === 0 || fetcher.state !== "idle"}
          onClick={() => {
            const formData = new FormData();
            formData.set("_intent", "cancelExceptionCase");
            formData.set("exceptionCaseId", caseId);
            formData.set("reason", reason);
            void fetcher.submit(formData, { method: "post", action: actionUrl });
          }}
          className="rounded-md bg-error px-2.5 py-1 text-xs text-white disabled:opacity-50"
        >
          Confirm cancellation
        </button>
        <button
          type="button"
          onClick={() => {
            setShowForm(false);
          }}
          className="rounded-md px-2.5 py-1 text-xs text-muted"
        >
          Back
        </button>
      </div>
      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="text-xs text-error">
          {fetcher.data.error}
        </p>
      ) : null}
    </div>
  );
}

export function ExceptionCaseDrawer({
  detail,
  assignableStaff,
  canUpdate,
  canAssign,
  canResolve,
  canCancel,
  canCreateNotes,
}: ExceptionCaseDrawerProps) {
  const { exceptionCase, proofGroups, activity, staffNames } = detail;
  const navigate = useNavigate();
  const location = useLocation();
  const actionUrl = "/exceptions/actions";
  const assignFetcher = useFetcher<ActionResponse>();
  const statusFetcher = useFetcher<ActionResponse>();
  const [assignedStaffId, setAssignedStaffId] = useState(exceptionCase.assignedStaffId ?? "");

  function close() {
    void navigate({ pathname: "/exceptions", search: location.search });
  }

  const isTerminal = exceptionCase.status === "RESOLVED" || exceptionCase.status === "CANCELLED";

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          onEscapeKeyDown={close}
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-lg focus:outline-none sm:w-[90vw] sm:max-w-3xl md:max-w-4xl"
        >
          <Dialog.Title className="sr-only">
            Exception case {exceptionCase.caseNumber} for order {exceptionCase.order.orderNumber}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Investigation and resolution workstation for exception case {exceptionCase.caseNumber},
            opened from the exceptions queue.
          </Dialog.Description>

          <header className="flex flex-col gap-3 border-b border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-ink">
                    Order {exceptionCase.order.orderNumber} — Case {exceptionCase.caseNumber}
                  </h2>
                  <Badge tone={STATUS_TONE[exceptionCase.status]}>
                    {EXCEPTION_CASE_STATUS_LABELS[exceptionCase.status]}
                  </Badge>
                  <Badge tone="neutral">
                    {EXCEPTION_CASE_CATEGORY_LABELS[exceptionCase.category]}
                  </Badge>
                  <Badge tone={exceptionCase.severity === "CRITICAL" ? "error" : "neutral"}>
                    {exceptionCase.severity}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted">
                  {exceptionCase.order.customerName ?? "No customer name on file"}
                </p>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close exception case"
                  onClick={close}
                  className="rounded-md p-2 text-muted hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            <p className="text-sm text-ink">{exceptionCase.summary}</p>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
              {canAssign ? (
                <label className="flex items-center gap-1.5">
                  Assigned
                  <select
                    value={assignedStaffId}
                    disabled={assignFetcher.state !== "idle"}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAssignedStaffId(value);
                      const formData = new FormData();
                      formData.set("_intent", "assignExceptionCase");
                      formData.set("exceptionCaseId", exceptionCase.id);
                      formData.set("targetStaffUserId", value);
                      formData.set("expectedStaffUserId", exceptionCase.assignedStaffId ?? "");
                      void assignFetcher.submit(formData, { method: "post", action: actionUrl });
                    }}
                    className="rounded border border-border bg-page px-1.5 py-1 text-xs text-ink"
                  >
                    <option value="">Unassigned</option>
                    {assignableStaff.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span>
                  Assigned:{" "}
                  {exceptionCase.assignedStaffId
                    ? (staffNames[exceptionCase.assignedStaffId] ?? "Unknown staff member")
                    : "Unassigned"}
                </span>
              )}
              <span>Created {formatAuDateTime(exceptionCase.createdAt)}</span>
              {exceptionCase.resolvedAt ? (
                <span>Resolved {formatAuDateTime(exceptionCase.resolvedAt)}</span>
              ) : null}
            </div>

            {canUpdate && !isTerminal ? (
              <div className="flex flex-wrap items-center gap-2">
                {exceptionCase.status === "OPEN" ? (
                  <button
                    type="button"
                    disabled={statusFetcher.state !== "idle"}
                    onClick={() => {
                      const formData = new FormData();
                      formData.set("_intent", "startInvestigation");
                      formData.set("exceptionCaseId", exceptionCase.id);
                      void statusFetcher.submit(formData, { method: "post", action: actionUrl });
                    }}
                    className="rounded-md border border-border px-2.5 py-1.5 text-sm text-ink hover:bg-page disabled:opacity-50"
                  >
                    Start investigation
                  </button>
                ) : null}
                {exceptionCase.status !== "AWAITING_CUSTOMER" ? (
                  <button
                    type="button"
                    disabled={statusFetcher.state !== "idle"}
                    onClick={() => {
                      const formData = new FormData();
                      formData.set("_intent", "markAwaitingCustomer");
                      formData.set("exceptionCaseId", exceptionCase.id);
                      void statusFetcher.submit(formData, { method: "post", action: actionUrl });
                    }}
                    className="rounded-md border border-border px-2.5 py-1.5 text-sm text-ink hover:bg-page disabled:opacity-50"
                  >
                    Awaiting customer
                  </button>
                ) : null}
                {statusFetcher.data && !statusFetcher.data.ok ? (
                  <p role="alert" className="text-xs text-error">
                    {statusFetcher.data.error}
                  </p>
                ) : null}
              </div>
            ) : null}
          </header>

          <Tabs.Root defaultValue="resolutions" className="flex min-h-0 flex-1 flex-col">
            <Tabs.List className="flex gap-1 overflow-x-auto border-b border-border px-4">
              {[
                {
                  value: "resolutions",
                  label: `Resolutions (${exceptionCase.resolutions.length})`,
                },
                { value: "details", label: "Details" },
                { value: "notes", label: `Notes (${exceptionCase.notes.length})` },
                { value: "activity", label: "Activity" },
              ].map((tab) => (
                <Tabs.Trigger
                  key={tab.value}
                  value={tab.value}
                  className="shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-navy data-[state=active]:border-brand-navy data-[state=active]:text-ink"
                >
                  {tab.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <Tabs.Content value="resolutions" className="flex flex-col gap-3">
                {exceptionCase.resolutions.length === 0 ? (
                  <EmptyState
                    title="No resolution recorded yet"
                    description="Record how this case was resolved — reprint, credit, refund, exchange, or denied."
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    {exceptionCase.resolutions.map((resolution) => (
                      <div
                        key={resolution.id}
                        className="rounded-lg border border-border bg-surface p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={resolution.status === "COMPLETED" ? "success" : "warning"}>
                            {EXCEPTION_RESOLUTION_STATUS_LABELS[resolution.status]}
                          </Badge>
                          <span className="font-medium text-ink">
                            {EXCEPTION_RESOLUTION_TYPE_LABELS[resolution.resolutionType]}
                          </span>
                          {resolution.amount ? (
                            <span className="text-ink">
                              {resolution.currencyCode ?? ""} {resolution.amount}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-ink">{resolution.reason}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          Decided by{" "}
                          {staffNames[resolution.decidedByStaffId] ?? "Unknown staff member"} ·{" "}
                          {formatAuDateTime(resolution.decidedAt)}
                        </p>
                        {resolution.completedAt ? (
                          <p className="mt-0.5 text-xs text-muted">
                            Completed by{" "}
                            {resolution.completedByStaffId
                              ? (staffNames[resolution.completedByStaffId] ??
                                "Unknown staff member")
                              : "Unknown staff member"}{" "}
                            · {formatAuDateTime(resolution.completedAt)}
                          </p>
                        ) : canResolve ? (
                          <div className="mt-1.5">
                            <MarkCompletedButton
                              actionUrl={actionUrl}
                              resolutionId={resolution.id}
                            />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                {canResolve && !isTerminal ? (
                  <ResolutionForm
                    actionUrl={actionUrl}
                    caseId={exceptionCase.id}
                    proofGroups={proofGroups}
                  />
                ) : null}
              </Tabs.Content>

              <Tabs.Content value="details" className="flex flex-col gap-4">
                {exceptionCase.customerNote ? (
                  <div>
                    <h5 className="text-xs font-medium text-muted">What the customer said</h5>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                      {exceptionCase.customerNote}
                    </p>
                  </div>
                ) : null}
                {exceptionCase.orderLine ? (
                  <div>
                    <h5 className="text-xs font-medium text-muted">Affected item</h5>
                    <p className="mt-1 text-sm text-ink">
                      {exceptionCase.orderLine.productTitle}
                      {exceptionCase.orderLine.variantTitle
                        ? ` — ${exceptionCase.orderLine.variantTitle}`
                        : ""}
                      {exceptionCase.orderLine.sku ? ` (${exceptionCase.orderLine.sku})` : ""}
                    </p>
                  </div>
                ) : null}
                <div>
                  <h5 className="text-xs font-medium text-muted">Return label</h5>
                  {exceptionCase.returnLabelProvidedAt ? (
                    <p className="mt-1 text-sm text-ink">
                      Recorded {formatAuDateTime(exceptionCase.returnLabelProvidedAt)}
                      {exceptionCase.returnLabelNote ? ` — ${exceptionCase.returnLabelNote}` : ""}
                    </p>
                  ) : canUpdate && !isTerminal ? (
                    <div className="mt-1">
                      <ReturnLabelForm actionUrl={actionUrl} caseId={exceptionCase.id} />
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-muted">No return label recorded.</p>
                  )}
                </div>
                {exceptionCase.cancelledAt ? (
                  <div>
                    <h5 className="text-xs font-medium text-muted">Cancelled</h5>
                    <p className="mt-1 text-sm text-ink">
                      {formatAuDateTime(exceptionCase.cancelledAt)} — {exceptionCase.cancelReason}
                    </p>
                  </div>
                ) : canCancel && !isTerminal ? (
                  <CancelCaseSection actionUrl={actionUrl} caseId={exceptionCase.id} />
                ) : null}
              </Tabs.Content>

              <Tabs.Content value="notes">
                {exceptionCase.notes.length === 0 ? (
                  <EmptyState
                    title="No notes yet"
                    description="Internal notes about this exception case appear here."
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    {exceptionCase.notes.map((note) => (
                      <div key={note.id} className="rounded border border-border px-3 py-2 text-sm">
                        <p className="whitespace-pre-wrap text-ink">{note.body}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {staffNames[note.authorStaffId] ?? "Unknown staff member"} ·{" "}
                          {formatAuDateTime(note.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {canCreateNotes ? (
                  <CaseNoteForm actionUrl={actionUrl} caseId={exceptionCase.id} />
                ) : null}
              </Tabs.Content>

              <Tabs.Content value="activity">
                {activity.length === 0 ? (
                  <EmptyState
                    title="No activity recorded"
                    description="Meaningful changes to this case will appear here as they happen."
                  />
                ) : (
                  <div className="flex flex-col gap-1">
                    {activity.map((event) => (
                      <div
                        key={event.id}
                        className="flex gap-3 border-b border-border py-2.5 last:border-b-0"
                      >
                        <div
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-navy"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-ink">{event.summary}</p>
                          <p className="mt-0.5 text-xs text-muted">
                            {actorLabel(event, staffNames)} · {formatAuDateTime(event.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
