import { useState } from "react";
import { useFetcher, useLocation, useNavigate } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import type { Severity, WarehouseIssueType } from "@prisma/client";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { EmptyState } from "~/components/shared/EmptyState";
import { BarcodeScanInput } from "~/components/shared/BarcodeScanInput";
import { PriorityBadge } from "~/components/board/CardBadges";
import {
  WAREHOUSE_PICK_JOB_STATUS_LABELS,
  WAREHOUSE_PICK_ITEM_STATUS_LABELS,
  WAREHOUSE_ISSUE_TYPE_LABELS,
  WAREHOUSE_ISSUE_STATUS_LABELS,
} from "~/domain/warehouse/labels";
import { formatAuDateTime } from "~/lib/dates";
import type { WarehousePickJobDetail } from "~/domain/warehouse/pick-job-detail-query.server";
import type { WarehousePickJobStatus, WarehousePickItemStatus } from "@prisma/client";

type ActionResponse =
  | { intent: string; ok: true; [key: string]: unknown }
  | { intent: string; ok: false; error: string };

export interface WarehousePickJobDrawerProps extends WarehousePickJobDetail {
  assignableStaff: { id: string; name: string }[];
  canAssign: boolean;
  canRecordQuantity: boolean;
  canMarkShort: boolean;
  canHandover: boolean;
  canCreateIssues: boolean;
  canResolveIssues: boolean;
  canCreateNotes: boolean;
}

const JOB_STATUS_TONE: Record<WarehousePickJobStatus, BadgeTone> = {
  QUEUED: "neutral",
  IN_PROGRESS: "neutral",
  HANDED_OVER: "success",
  CANCELLED: "neutral",
};

const ITEM_STATUS_TONE: Record<WarehousePickItemStatus, BadgeTone> = {
  PENDING: "neutral",
  IN_PROGRESS: "neutral",
  PICKED: "success",
  SHORT: "warning",
};

const ISSUE_STATUS_TONE: Record<string, BadgeTone> = {
  OPEN: "error",
  INVESTIGATING: "warning",
  WAITING: "warning",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

const ISSUE_TYPES: WarehouseIssueType[] = [
  "STOCK_SHORTAGE",
  "DAMAGED_STOCK",
  "WRONG_LOCATION",
  "MISSING_ITEM",
  "OTHER",
];
const SEVERITIES: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function actorLabel(
  event: WarehousePickJobDetail["activity"][number],
  staffNames: Record<string, string>,
): string {
  if (event.actorType === "SYSTEM") return "System";
  if (event.actorType === "CUSTOMER") return "Customer";
  return event.actorStaffId
    ? (staffNames[event.actorStaffId] ?? "Unknown staff member")
    : "Unknown staff member";
}

function PickItemRow({
  actionUrl,
  item,
  canRecordQuantity,
  canMarkShort,
}: {
  actionUrl: string;
  item: WarehousePickJobDetail["job"]["items"][number];
  canRecordQuantity: boolean;
  canMarkShort: boolean;
}) {
  const quantityFetcher = useFetcher<ActionResponse>();
  const shortFetcher = useFetcher<ActionResponse>();
  const scanFetcher = useFetcher<ActionResponse>();
  const [newlyPicked, setNewlyPicked] = useState("0");
  const [showShortForm, setShowShortForm] = useState(false);
  const [shortReason, setShortReason] = useState("");
  const [pendingScanMismatch, setPendingScanMismatch] = useState<{
    scannedValue: string;
    overrideReason: string;
  } | null>(null);
  const remaining = item.requiredQuantity - item.pickedQuantity - item.shortQuantity;
  const isTerminal = item.status === "PICKED" || item.status === "SHORT";
  const openBlockingIssue = item.issues.some(
    (i) =>
      i.isBlocking &&
      (i.status === "OPEN" || i.status === "INVESTIGATING" || i.status === "WAITING"),
  );

  return (
    <div className="rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-ink">{item.productTitle}</p>
          <p className="text-xs text-muted">{item.sku ?? "No SKU"}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {openBlockingIssue ? <Badge tone="error">Blocked</Badge> : null}
          <Badge tone={ITEM_STATUS_TONE[item.status]}>
            {WAREHOUSE_PICK_ITEM_STATUS_LABELS[item.status]}
          </Badge>
        </div>
      </div>
      <p className="mt-1 text-ink">
        {item.pickedQuantity} picked
        {item.shortQuantity > 0 ? `, ${item.shortQuantity} short` : ""} / {item.requiredQuantity}{" "}
        required
      </p>
      {item.shortReason ? (
        <p className="mt-0.5 text-xs text-warning">Short: {item.shortReason}</p>
      ) : null}

      {!isTerminal && !openBlockingIssue ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {canRecordQuantity ? (
              <>
                <input
                  type="number"
                  min={1}
                  max={remaining}
                  value={newlyPicked}
                  onChange={(e) => {
                    setNewlyPicked(e.target.value);
                  }}
                  className="w-20 rounded border border-border px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  disabled={
                    Number(newlyPicked) <= 0 ||
                    Number(newlyPicked) > remaining ||
                    quantityFetcher.state !== "idle"
                  }
                  onClick={() => {
                    const formData = new FormData();
                    formData.set("_intent", "recordQuantity");
                    formData.set("warehousePickItemId", item.id);
                    formData.set("newlyPickedQuantity", newlyPicked);
                    formData.set("idempotencyKey", crypto.randomUUID());
                    void quantityFetcher.submit(formData, { method: "post", action: actionUrl });
                    setNewlyPicked("0");
                  }}
                  className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
                >
                  Record pick
                </button>
              </>
            ) : null}
          </div>
          {canRecordQuantity ? (
            <div className="flex flex-col gap-1.5">
              <BarcodeScanInput
                disabled={scanFetcher.state !== "idle"}
                onScan={(scannedValue) => {
                  const formData = new FormData();
                  formData.set("_intent", "scanPickQuantity");
                  formData.set("warehousePickItemId", item.id);
                  formData.set("scannedValue", scannedValue);
                  void scanFetcher.submit(formData, { method: "post", action: actionUrl });
                  setPendingScanMismatch({ scannedValue, overrideReason: "" });
                }}
              />
              {scanFetcher.data && !scanFetcher.data.ok && pendingScanMismatch ? (
                <div className="flex flex-col gap-1 rounded border border-warning/40 bg-warning/5 p-2">
                  <p role="alert" className="text-xs text-warning">
                    {scanFetcher.data.error}
                  </p>
                  <input
                    type="text"
                    placeholder="Override reason (required)"
                    value={pendingScanMismatch.overrideReason}
                    onChange={(e) => {
                      setPendingScanMismatch({
                        scannedValue: pendingScanMismatch.scannedValue,
                        overrideReason: e.target.value,
                      });
                    }}
                    className="rounded border border-border px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    disabled={
                      pendingScanMismatch.overrideReason.trim().length === 0 ||
                      scanFetcher.state !== "idle"
                    }
                    onClick={() => {
                      const formData = new FormData();
                      formData.set("_intent", "scanPickQuantity");
                      formData.set("warehousePickItemId", item.id);
                      formData.set("scannedValue", pendingScanMismatch.scannedValue);
                      formData.set("overrideReason", pendingScanMismatch.overrideReason);
                      void scanFetcher.submit(formData, { method: "post", action: actionUrl });
                      setPendingScanMismatch(null);
                    }}
                    className="self-start rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
                  >
                    Record with override
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            {canMarkShort ? (
              <button
                type="button"
                onClick={() => {
                  setShowShortForm(true);
                }}
                className="text-xs text-brand-navy hover:underline"
              >
                Mark remainder short
              </button>
            ) : null}
          </div>
          {quantityFetcher.data && !quantityFetcher.data.ok ? (
            <p role="alert" className="text-xs text-error">
              {quantityFetcher.data.error}
            </p>
          ) : null}

          {showShortForm ? (
            <div className="flex flex-col gap-2 rounded border border-border bg-page p-2">
              <textarea
                placeholder="Why can't the remainder be picked? (required)"
                value={shortReason}
                onChange={(e) => {
                  setShortReason(e.target.value);
                }}
                rows={2}
                className="rounded border border-border px-2 py-1 text-xs"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={shortReason.trim().length === 0 || shortFetcher.state !== "idle"}
                  onClick={() => {
                    const formData = new FormData();
                    formData.set("_intent", "markShort");
                    formData.set("warehousePickItemId", item.id);
                    formData.set("reason", shortReason.trim());
                    void shortFetcher.submit(formData, { method: "post", action: actionUrl });
                    setShowShortForm(false);
                    setShortReason("");
                  }}
                  className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
                >
                  Mark short
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowShortForm(false);
                  }}
                  className="rounded-md px-2.5 py-1 text-xs text-muted"
                >
                  Cancel
                </button>
              </div>
              {shortFetcher.data && !shortFetcher.data.ok ? (
                <p role="alert" className="text-xs text-error">
                  {shortFetcher.data.error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function JobNoteForm({ actionUrl, jobId }: { actionUrl: string; jobId: string }) {
  const fetcher = useFetcher<ActionResponse>();
  const [body, setBody] = useState("");
  return (
    <div className="mt-2 flex gap-2">
      <input
        type="text"
        placeholder="Add an internal note about this pick job…"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
        }}
        className="flex-1 rounded border border-border px-2 py-1.5 text-sm"
      />
      <button
        type="button"
        disabled={body.trim().length === 0 || fetcher.state !== "idle"}
        onClick={() => {
          const formData = new FormData();
          formData.set("_intent", "createNote");
          formData.set("warehousePickJobId", jobId);
          formData.set("body", body.trim());
          void fetcher.submit(formData, { method: "post", action: actionUrl });
          setBody("");
        }}
        className="rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        Add note
      </button>
      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="text-xs text-error">
          {fetcher.data.error}
        </p>
      ) : null}
    </div>
  );
}

function JobLevelIssueForm({ actionUrl, jobId }: { actionUrl: string; jobId: string }) {
  const fetcher = useFetcher<ActionResponse>();
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState<WarehouseIssueType>("OTHER");
  const [severity, setSeverity] = useState<Severity>("MEDIUM");
  const [isBlocking, setIsBlocking] = useState(false);
  const [showForm, setShowForm] = useState(false);

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => {
          setShowForm(true);
        }}
        className="text-xs text-brand-navy hover:underline"
      >
        Report a job-level issue
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-page p-2">
      <div className="flex flex-wrap gap-2">
        <select
          value={issueType}
          onChange={(e) => {
            setIssueType(e.target.value as WarehouseIssueType);
          }}
          className="rounded border border-border px-2 py-1 text-xs"
        >
          {ISSUE_TYPES.map((type) => (
            <option key={type} value={type}>
              {WAREHOUSE_ISSUE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <select
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value as Severity);
          }}
          className="rounded border border-border px-2 py-1 text-xs"
        >
          {SEVERITIES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-muted">
          <input
            type="checkbox"
            checked={isBlocking}
            onChange={(e) => {
              setIsBlocking(e.target.checked);
            }}
            className="h-3.5 w-3.5"
          />
          Blocking
        </label>
      </div>
      <textarea
        placeholder="Describe the issue (required) — job-level issues aren't tied to one line"
        value={description}
        onChange={(e) => {
          setDescription(e.target.value);
        }}
        rows={2}
        className="rounded border border-border px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={description.trim().length === 0 || fetcher.state !== "idle"}
          onClick={() => {
            const formData = new FormData();
            formData.set("_intent", "createIssue");
            formData.set("warehousePickJobId", jobId);
            formData.set("issueType", issueType);
            formData.set("severity", severity);
            formData.set("description", description.trim());
            formData.set("isBlocking", String(isBlocking));
            void fetcher.submit(formData, { method: "post", action: actionUrl });
            setShowForm(false);
            setDescription("");
          }}
          className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
        >
          Submit
        </button>
        <button
          type="button"
          onClick={() => {
            setShowForm(false);
          }}
          className="rounded-md px-2.5 py-1 text-xs text-muted"
        >
          Cancel
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

export function WarehousePickJobDrawer({
  job,
  activity,
  staffNames,
  assignableStaff,
  canAssign,
  canRecordQuantity,
  canMarkShort,
  canHandover,
  canCreateIssues,
  canCreateNotes,
}: WarehousePickJobDrawerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const actionUrl = "/warehouse/actions";
  const handoverFetcher = useFetcher<ActionResponse>();
  const assignFetcher = useFetcher<ActionResponse>();
  const [assignedStaffId, setAssignedStaffId] = useState(job.assignedStaffId ?? "");

  function close() {
    void navigate({ pathname: "/warehouse", search: location.search });
  }

  const unfinishedCount = job.items.filter(
    (i) => i.status === "PENDING" || i.status === "IN_PROGRESS",
  ).length;
  const canHandoverNow =
    canHandover &&
    job.status !== "HANDED_OVER" &&
    job.status !== "CANCELLED" &&
    unfinishedCount === 0;

  const allIssues = [
    ...job.issues.map((issue) => ({ issue, itemLabel: null as string | null })),
    ...job.items.flatMap((item) =>
      item.issues.map((issue) => ({ issue, itemLabel: item.productTitle })),
    ),
  ].sort((a, b) => b.issue.createdAt.getTime() - a.issue.createdAt.getTime());

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
            Warehouse pick job for order {job.order.orderNumber}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Pick-list workstation for order {job.order.orderNumber}, opened from the warehouse
            queue.
          </Dialog.Description>

          <header className="flex flex-col gap-3 border-b border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-ink">
                    Order {job.order.orderNumber} — Pick job
                  </h2>
                  <Badge tone={JOB_STATUS_TONE[job.status]}>
                    {WAREHOUSE_PICK_JOB_STATUS_LABELS[job.status]}
                  </Badge>
                  <PriorityBadge priority={job.priority} />
                </div>
                <p className="mt-0.5 truncate text-sm text-muted">
                  {job.order.customerName ?? "No customer name on file"}
                  {job.order.isPreorder ? " · Preorder" : ""}
                </p>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close warehouse pick job"
                  onClick={close}
                  className="rounded-md p-2 text-muted hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

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
                      formData.set("_intent", "assignJob");
                      formData.set("warehousePickJobId", job.id);
                      formData.set("targetStaffUserId", value);
                      formData.set("expectedVersion", String(job.version));
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
                  {job.assignedStaffId
                    ? (staffNames[job.assignedStaffId] ?? "Unknown staff member")
                    : "Unassigned"}
                </span>
              )}
              <span>Created {formatAuDateTime(job.createdAt)}</span>
              {job.handedOverAt ? (
                <span>Handed over {formatAuDateTime(job.handedOverAt)}</span>
              ) : null}
            </div>

            {job.status !== "HANDED_OVER" && job.status !== "CANCELLED" ? (
              <div>
                <button
                  type="button"
                  disabled={!canHandoverNow || handoverFetcher.state !== "idle"}
                  onClick={() => {
                    const formData = new FormData();
                    formData.set("_intent", "handoverJob");
                    formData.set("warehousePickJobId", job.id);
                    void handoverFetcher.submit(formData, { method: "post", action: actionUrl });
                  }}
                  className="rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  Hand over to packing
                </button>
                {!canHandoverNow && unfinishedCount > 0 ? (
                  <p className="mt-1 text-xs text-muted">
                    {unfinishedCount} line(s) still need to be picked or marked short.
                  </p>
                ) : null}
                {handoverFetcher.data && !handoverFetcher.data.ok ? (
                  <p role="alert" className="mt-1 text-xs text-error">
                    {handoverFetcher.data.error}
                  </p>
                ) : null}
              </div>
            ) : null}
          </header>

          <Tabs.Root defaultValue="items" className="flex min-h-0 flex-1 flex-col">
            <Tabs.List className="flex gap-1 overflow-x-auto border-b border-border px-4">
              {[
                { value: "items", label: `Pick list (${job.items.length})` },
                { value: "issues", label: `Issues (${allIssues.length})` },
                { value: "notes", label: `Notes (${job.notes.length})` },
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
              <Tabs.Content value="items">
                {job.items.length === 0 ? (
                  <EmptyState
                    title="No lines on this pick job"
                    description="Lines are created automatically, one per order line."
                  />
                ) : (
                  <div className="flex flex-col gap-3">
                    {job.items.map((item) => (
                      <PickItemRow
                        key={item.id}
                        actionUrl={actionUrl}
                        item={item}
                        canRecordQuantity={canRecordQuantity}
                        canMarkShort={canMarkShort}
                      />
                    ))}
                  </div>
                )}
              </Tabs.Content>

              <Tabs.Content value="issues">
                {allIssues.length === 0 ? (
                  <EmptyState
                    title="No issues reported"
                    description="Warehouse issues raised on this job or any of its lines appear here."
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    {allIssues.map(({ issue, itemLabel }) => (
                      <div
                        key={issue.id}
                        className="rounded-lg border border-border bg-surface p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={ISSUE_STATUS_TONE[issue.status] ?? "neutral"}>
                            {WAREHOUSE_ISSUE_STATUS_LABELS[issue.status]}
                          </Badge>
                          <span className="text-ink">
                            {WAREHOUSE_ISSUE_TYPE_LABELS[issue.issueType]}
                          </span>
                          {issue.isBlocking ? <Badge tone="error">Blocking</Badge> : null}
                          {itemLabel ? (
                            <span className="text-xs text-muted">Line: {itemLabel}</span>
                          ) : (
                            <span className="text-xs text-muted">Job-level</span>
                          )}
                        </div>
                        <p className="mt-1 text-ink">{issue.description}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {staffNames[issue.createdByStaffId] ?? "Unknown staff member"} ·{" "}
                          {formatAuDateTime(issue.createdAt)}
                        </p>
                        {issue.resolutionNote ? (
                          <p className="mt-0.5 text-xs text-muted">
                            Resolution: {issue.resolutionNote}
                            {issue.resolvedAt ? ` (${formatAuDateTime(issue.resolvedAt)})` : ""}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                {canCreateIssues ? (
                  <div className="mt-3">
                    <JobLevelIssueForm actionUrl={actionUrl} jobId={job.id} />
                  </div>
                ) : null}
              </Tabs.Content>

              <Tabs.Content value="notes">
                {job.notes.length === 0 ? (
                  <EmptyState
                    title="No notes yet"
                    description="Internal notes about this pick job appear here."
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    {job.notes.map((note) => (
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
                {canCreateNotes ? <JobNoteForm actionUrl={actionUrl} jobId={job.id} /> : null}
              </Tabs.Content>

              <Tabs.Content value="activity">
                {activity.length === 0 ? (
                  <EmptyState
                    title="No activity recorded"
                    description="Meaningful changes to this job and its lines will appear here as they happen."
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
