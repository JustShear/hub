import { useState } from "react";
import { useFetcher, useLocation, useNavigate } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { EmptyState } from "~/components/shared/EmptyState";
import { PriorityBadge } from "~/components/board/CardBadges";
import {
  DECORATION_WORKSTREAM_LABELS,
  PRODUCTION_JOB_STATUS_LABELS,
  PRODUCTION_ISSUE_TYPE_LABELS,
  PRODUCTION_ISSUE_STATUS_LABELS,
} from "~/domain/production/labels";
import { formatAuDate, formatAuDateTime } from "~/lib/dates";
import { ProductionTaskCard } from "~/components/production/ProductionTaskCard";
import type { ProductionJobDetail } from "~/domain/production/job-detail-query.server";
import type { ProductionJobStatus } from "@prisma/client";

type ActionResponse =
  | { intent: string; ok: true; [key: string]: unknown }
  | { intent: string; ok: false; error: string };

export interface ProductionJobDrawerProps extends ProductionJobDetail {
  assignableStaff: { id: string; name: string }[];
  canAssign: boolean;
  canUpdate: boolean;
  canStart: boolean;
  canPause: boolean;
  canComplete: boolean;
  canReopen: boolean;
  canUpdateQuantities: boolean;
  canOverrideQuantities: boolean;
  canPerformQualityCheck: boolean;
  canCreateIssues: boolean;
  canResolveIssues: boolean;
  canCreateNotes: boolean;
  canDownloadArtwork: boolean;
}

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

const ISSUE_STATUS_TONE: Record<string, BadgeTone> = {
  OPEN: "error",
  INVESTIGATING: "warning",
  WAITING: "warning",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

function actorLabel(
  event: ProductionJobDetail["activity"][number],
  staffNames: Record<string, string>,
): string {
  if (event.actorType === "SYSTEM") return "System";
  if (event.actorType === "CUSTOMER") return "Customer";
  return event.actorStaffId
    ? (staffNames[event.actorStaffId] ?? "Unknown staff member")
    : "Unknown staff member";
}

function JobNoteForm({
  actionUrl,
  productionJobId,
}: {
  actionUrl: string;
  productionJobId: string;
}) {
  const fetcher = useFetcher<ActionResponse>();
  const [body, setBody] = useState("");
  return (
    <div className="mt-2 flex gap-2">
      <input
        type="text"
        placeholder="Add an internal note about this job…"
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
          formData.set("productionJobId", productionJobId);
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

export function ProductionJobDrawer({
  job,
  activity,
  staffNames,
  openIssueTaskIds,
  assignableStaff,
  canAssign,
  canStart,
  canPause,
  canComplete,
  canReopen,
  canUpdateQuantities,
  canOverrideQuantities,
  canPerformQualityCheck,
  canCreateIssues,
  canResolveIssues,
  canCreateNotes,
}: ProductionJobDrawerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const actionUrl = "/production/actions";
  const openIssueTaskIdSet = new Set(openIssueTaskIds);

  function close() {
    void navigate({ pathname: "/production", search: location.search });
  }

  const jobLevelIssues = job.issues;
  const allIssues = [
    ...jobLevelIssues.map((issue) => ({ issue, taskLabel: null as string | null })),
    ...job.tasks.flatMap((task) =>
      task.issues.map((issue) => ({ issue, taskLabel: task.proofGroup.name })),
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
            Production job {job.jobNumber} for order {job.order.orderNumber}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Workstation view for production job {job.jobNumber}, opened from the production queue.
          </Dialog.Description>

          <header className="flex flex-col gap-3 border-b border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-ink">
                    Job {job.jobNumber} — Order {job.order.orderNumber}
                  </h2>
                  <Badge tone={STATUS_TONE[job.status]}>
                    {PRODUCTION_JOB_STATUS_LABELS[job.status]}
                  </Badge>
                  <PriorityBadge priority={job.priority} />
                  <Badge tone="neutral">{DECORATION_WORKSTREAM_LABELS[job.decorationMethod]}</Badge>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted">
                  {job.order.customerName ?? "No customer name on file"}
                  {job.order.isPreorder ? " · Preorder" : ""}
                </p>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close production job"
                  onClick={close}
                  className="rounded-md p-2 text-muted hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>Export batch {job.exportBatch.batchNumber}</span>
              <span>
                Assigned:{" "}
                {job.assignedStaffId
                  ? (staffNames[job.assignedStaffId] ?? "Unknown staff member")
                  : "Unassigned"}
              </span>
              <span>Due: {job.dueDate ? formatAuDate(job.dueDate) : "None set"}</span>
              <span>Created {formatAuDateTime(job.createdAt)}</span>
              {job.completedAt ? <span>Completed {formatAuDateTime(job.completedAt)}</span> : null}
            </div>
          </header>

          <Tabs.Root defaultValue="tasks" className="flex min-h-0 flex-1 flex-col">
            <Tabs.List className="flex gap-1 overflow-x-auto border-b border-border px-4">
              {[
                { value: "tasks", label: `Tasks (${job.tasks.length})` },
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
              <Tabs.Content value="tasks">
                {job.tasks.length === 0 ? (
                  <EmptyState
                    title="No production tasks yet"
                    description="Tasks are created automatically, one per exported artwork item."
                  />
                ) : (
                  <div className="flex flex-col gap-3">
                    {job.tasks.map((task) => (
                      <ProductionTaskCard
                        key={task.id}
                        actionUrl={actionUrl}
                        productionJobId={job.id}
                        task={task}
                        assignableStaff={assignableStaff}
                        staffNames={staffNames}
                        hasOpenIssue={openIssueTaskIdSet.has(task.id)}
                        canAssign={canAssign}
                        canStart={canStart}
                        canPause={canPause}
                        canComplete={canComplete}
                        canReopen={canReopen}
                        canUpdateQuantities={canUpdateQuantities}
                        canOverrideQuantities={canOverrideQuantities}
                        canPerformQualityCheck={canPerformQualityCheck}
                        canCreateIssues={canCreateIssues}
                        canResolveIssues={canResolveIssues}
                        canCreateNotes={canCreateNotes}
                      />
                    ))}
                  </div>
                )}
              </Tabs.Content>

              <Tabs.Content value="issues">
                {allIssues.length === 0 ? (
                  <EmptyState
                    title="No issues reported"
                    description="Production issues raised on this job or any of its tasks appear here."
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    {allIssues.map(({ issue, taskLabel }) => (
                      <div
                        key={issue.id}
                        className="rounded-lg border border-border bg-surface p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={ISSUE_STATUS_TONE[issue.status] ?? "neutral"}>
                            {PRODUCTION_ISSUE_STATUS_LABELS[issue.status]}
                          </Badge>
                          <span className="text-ink">
                            {PRODUCTION_ISSUE_TYPE_LABELS[issue.issueType]}
                          </span>
                          {issue.isBlocking ? <Badge tone="error">Blocking</Badge> : null}
                          {taskLabel ? (
                            <span className="text-xs text-muted">Task: {taskLabel}</span>
                          ) : (
                            <span className="text-xs text-muted">Job-level</span>
                          )}
                        </div>
                        <p className="mt-1 text-ink">{issue.description}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {staffNames[issue.createdByStaffId] ?? "Unknown staff member"} ·{" "}
                          {formatAuDateTime(issue.createdAt)}
                        </p>
                        {issue.resolution ? (
                          <p className="mt-0.5 text-xs text-muted">
                            Resolution: {issue.resolution}
                            {issue.resolvedAt ? ` (${formatAuDateTime(issue.resolvedAt)})` : ""}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                {canCreateIssues ? (
                  <div className="mt-3">
                    <JobLevelIssueForm actionUrl={actionUrl} productionJobId={job.id} />
                  </div>
                ) : null}
              </Tabs.Content>

              <Tabs.Content value="notes">
                {job.notes.length === 0 ? (
                  <EmptyState
                    title="No notes yet"
                    description="Internal notes about this job (not tied to a specific task) appear here."
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
                {canCreateNotes ? (
                  <JobNoteForm actionUrl={actionUrl} productionJobId={job.id} />
                ) : null}
              </Tabs.Content>

              <Tabs.Content value="activity">
                {activity.length === 0 ? (
                  <EmptyState
                    title="No activity recorded"
                    description="Meaningful changes to this job and its tasks will appear here as they happen."
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

function JobLevelIssueForm({
  actionUrl,
  productionJobId,
}: {
  actionUrl: string;
  productionJobId: string;
}) {
  const fetcher = useFetcher<ActionResponse>();
  const [description, setDescription] = useState("");
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
      <textarea
        placeholder="Describe the issue (required) — job-level issues aren't tied to one task"
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
            formData.set("productionJobId", productionJobId);
            formData.set("issueType", "OTHER");
            formData.set("severity", "MEDIUM");
            formData.set("description", description.trim());
            formData.set("isBlocking", "false");
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
