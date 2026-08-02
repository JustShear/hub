import { useState } from "react";
import { useFetcher } from "react-router";
import { AlertTriangle, ChevronDown, ChevronRight, File as FileIcon } from "lucide-react";
import type { ProductionIssueType, Severity } from "@prisma/client";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { BarcodeScanInput } from "~/components/shared/BarcodeScanInput";
import {
  PRODUCTION_TASK_STATUS_LABELS,
  PRODUCTION_TASK_TYPE_LABELS,
  PRODUCTION_ISSUE_TYPE_LABELS,
  PRODUCTION_ISSUE_STATUS_LABELS,
  PAUSE_REASONS,
  PAUSE_REASON_LABELS,
} from "~/domain/production/labels";
import { getQualityChecklist } from "~/domain/production/quality-checklist";
import { formatAuDateTime } from "~/lib/dates";
import type { ProductionJobDetail } from "~/domain/production/job-detail-query.server";

type Task = ProductionJobDetail["job"]["tasks"][number];

type ActionResponse =
  | { intent: string; ok: true; [key: string]: unknown }
  | { intent: string; ok: false; error: string; issues?: string[] };

const STATUS_TONE: Record<Task["status"], BadgeTone> = {
  QUEUED: "neutral",
  READY: "neutral",
  IN_PROGRESS: "neutral",
  PAUSED: "warning",
  BLOCKED: "error",
  PARTIALLY_COMPLETE: "warning",
  AWAITING_QUALITY_CHECK: "warning",
  COMPLETE: "success",
  FAILED: "error",
  CANCELLED: "neutral",
};

const ISSUE_STATUS_TONE: Record<string, BadgeTone> = {
  OPEN: "error",
  INVESTIGATING: "warning",
  WAITING: "warning",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

const ISSUE_TYPES: ProductionIssueType[] = [
  "ARTWORK_PROBLEM",
  "WRONG_FILE",
  "WRONG_PLACEMENT",
  "WRONG_COLOUR",
  "GARMENT_DAMAGE",
  "PRINT_DEFECT",
  "EMBROIDERY_DEFECT",
  "EQUIPMENT_ISSUE",
  "STOCK_SHORTAGE",
  "QUANTITY_DISCREPANCY",
  "OTHER",
];
const SEVERITIES: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function AssignSection({
  actionUrl,
  task,
  assignableStaff,
  staffNames,
}: {
  actionUrl: string;
  task: Task;
  assignableStaff: { id: string; name: string }[];
  staffNames: Record<string, string>;
}) {
  const fetcher = useFetcher<ActionResponse>();
  const [selected, setSelected] = useState(task.assignedStaffId ?? "");
  const response = fetcher.data;

  return (
    <div>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Assigned staff
        <select
          value={selected}
          disabled={fetcher.state !== "idle"}
          onChange={(e) => {
            const value = e.target.value;
            setSelected(value);
            const formData = new FormData();
            formData.set("_intent", "assignTask");
            formData.set("productionTaskId", task.id);
            formData.set("targetStaffUserId", value);
            formData.set("expectedVersion", String(task.version));
            void fetcher.submit(formData, { method: "post", action: actionUrl });
          }}
          className="rounded border border-border bg-page px-2 py-1.5 text-sm text-ink"
        >
          <option value="">Unassigned</option>
          {assignableStaff.map((staff) => (
            <option key={staff.id} value={staff.id}>
              {staff.name}
            </option>
          ))}
        </select>
      </label>
      {!assignableStaff.some((s) => s.id === task.assignedStaffId) && task.assignedStaffId ? (
        <p className="mt-0.5 text-xs text-muted">
          Currently: {staffNames[task.assignedStaffId] ?? "Unknown staff member"}
        </p>
      ) : null}
      {response && !response.ok ? (
        <p role="alert" className="mt-1 text-xs text-error">
          {response.error}
        </p>
      ) : null}
    </div>
  );
}

function LifecycleControls({
  actionUrl,
  task,
  canStart,
  canPause,
  canComplete,
  canReopen,
  openIssue,
}: {
  actionUrl: string;
  task: Task;
  canStart: boolean;
  canPause: boolean;
  canComplete: boolean;
  canReopen: boolean;
  openIssue: boolean;
}) {
  const startFetcher = useFetcher<ActionResponse>();
  const pauseFetcher = useFetcher<ActionResponse>();
  const completeFetcher = useFetcher<ActionResponse>();
  const reopenFetcher = useFetcher<ActionResponse>();
  const [showPauseForm, setShowPauseForm] = useState(false);
  const [reasonCode, setReasonCode] = useState<(typeof PAUSE_REASONS)[number]>("WAITING_FOR_STOCK");
  const [otherText, setOtherText] = useState("");
  const [showReopenForm, setShowReopenForm] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  function submit(fetcher: typeof startFetcher, intent: string, extra?: Record<string, string>) {
    const formData = new FormData();
    formData.set("_intent", intent);
    formData.set("productionTaskId", task.id);
    for (const [key, value] of Object.entries(extra ?? {})) formData.set(key, value);
    void fetcher.submit(formData, { method: "post", action: actionUrl });
  }

  const canStartNow =
    canStart &&
    (task.status === "QUEUED" || task.status === "READY" || task.status === "PARTIALLY_COMPLETE");
  const canPauseNow = canPause && task.status === "IN_PROGRESS";
  const canResumeNow = canPause && task.status === "PAUSED";
  const canCompleteNow =
    canComplete &&
    task.status !== "COMPLETE" &&
    task.status !== "CANCELLED" &&
    task.status !== "FAILED";
  const canReopenNow = canReopen && task.status === "COMPLETE";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canStartNow ? (
          <button
            type="button"
            disabled={startFetcher.state !== "idle" || openIssue}
            onClick={() => {
              submit(startFetcher, "startTask");
            }}
            className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
          >
            Start
          </button>
        ) : null}
        {canPauseNow ? (
          <button
            type="button"
            onClick={() => {
              setShowPauseForm((v) => !v);
            }}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-ink"
          >
            Pause
          </button>
        ) : null}
        {canResumeNow ? (
          <button
            type="button"
            disabled={pauseFetcher.state !== "idle"}
            onClick={() => {
              submit(pauseFetcher, "resumeTask");
            }}
            className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
          >
            Resume
          </button>
        ) : null}
        {canCompleteNow ? (
          <button
            type="button"
            disabled={completeFetcher.state !== "idle"}
            onClick={() => {
              submit(completeFetcher, "completeTask");
            }}
            className="rounded-md bg-success px-2.5 py-1 text-xs text-white disabled:opacity-50"
          >
            Mark complete
          </button>
        ) : null}
        {canReopenNow ? (
          <button
            type="button"
            onClick={() => {
              setShowReopenForm((v) => !v);
            }}
            className="rounded-md border border-warning px-2.5 py-1 text-xs text-warning"
          >
            Reopen
          </button>
        ) : null}
      </div>

      {showPauseForm ? (
        <div className="flex flex-col gap-1 rounded border border-border bg-page p-2">
          <select
            value={reasonCode}
            onChange={(e) => {
              setReasonCode(e.target.value as (typeof PAUSE_REASONS)[number]);
            }}
            className="rounded border border-border px-2 py-1 text-xs"
          >
            {PAUSE_REASONS.map((code) => (
              <option key={code} value={code}>
                {PAUSE_REASON_LABELS[code]}
              </option>
            ))}
          </select>
          {reasonCode === "OTHER" ? (
            <input
              type="text"
              placeholder="Explain why (required)"
              value={otherText}
              onChange={(e) => {
                setOtherText(e.target.value);
              }}
              className="rounded border border-border px-2 py-1 text-xs"
            />
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={
                pauseFetcher.state !== "idle" ||
                (reasonCode === "OTHER" && otherText.trim().length === 0)
              }
              onClick={() => {
                submit(pauseFetcher, "pauseTask", { reasonCode, otherText });
                setShowPauseForm(false);
              }}
              className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
            >
              Confirm pause
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPauseForm(false);
              }}
              className="rounded-md px-2.5 py-1 text-xs text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {showReopenForm ? (
        <div className="flex flex-col gap-1 rounded border border-warning/40 bg-warning/5 p-2">
          <input
            type="text"
            placeholder="Reason for reopening (required)"
            value={reopenReason}
            onChange={(e) => {
              setReopenReason(e.target.value);
            }}
            className="rounded border border-border px-2 py-1 text-xs"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={reopenReason.trim().length === 0 || reopenFetcher.state !== "idle"}
              onClick={() => {
                submit(reopenFetcher, "reopenTask", { reason: reopenReason });
                setShowReopenForm(false);
              }}
              className="rounded-md bg-warning px-2.5 py-1 text-xs text-white disabled:opacity-50"
            >
              Confirm reopen
            </button>
            <button
              type="button"
              onClick={() => {
                setShowReopenForm(false);
              }}
              className="rounded-md px-2.5 py-1 text-xs text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {[startFetcher, pauseFetcher, completeFetcher, reopenFetcher].map((f, i) =>
        f.data && !f.data.ok ? (
          <div key={i}>
            <p role="alert" className="text-xs text-error">
              {f.data.error}
            </p>
            {"issues" in f.data && f.data.issues ? (
              <ul className="list-disc pl-4 text-xs text-error">
                {f.data.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null,
      )}
    </div>
  );
}

function QuantityForm({
  actionUrl,
  task,
  canOverride,
}: {
  actionUrl: string;
  task: Task;
  canOverride: boolean;
}) {
  const fetcher = useFetcher<ActionResponse>();
  const scanFetcher = useFetcher<ActionResponse>();
  const [produced, setProduced] = useState("0");
  const [failed, setFailed] = useState("0");
  const [reworked, setReworked] = useState("0");
  const [overrideReason, setOverrideReason] = useState("");
  const remaining = task.requiredQuantity - task.completedQuantity - task.failedQuantity;
  const wouldExceed = Number(produced || "0") + Number(failed || "0") > Math.max(remaining, 0);

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-page p-2">
      <p className="text-xs font-medium text-muted">
        Required {task.requiredQuantity} · Completed {task.completedQuantity} · Failed{" "}
        {task.failedQuantity} · Rework total {task.reworkQuantity} · Remaining{" "}
        {Math.max(remaining, 0)}
      </p>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          Newly produced
          <input
            type="number"
            min={0}
            value={produced}
            onChange={(e) => {
              setProduced(e.target.value);
            }}
            className="w-24 rounded border border-border px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          Newly failed
          <input
            type="number"
            min={0}
            value={failed}
            onChange={(e) => {
              setFailed(e.target.value);
            }}
            className="w-24 rounded border border-border px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          Reworked (from failed)
          <input
            type="number"
            min={0}
            value={reworked}
            onChange={(e) => {
              setReworked(e.target.value);
            }}
            className="w-24 rounded border border-border px-2 py-1 text-sm"
          />
        </label>
      </div>
      {wouldExceed ? (
        canOverride ? (
          <input
            type="text"
            placeholder="Reason for exceeding required quantity (required)"
            value={overrideReason}
            onChange={(e) => {
              setOverrideReason(e.target.value);
            }}
            className="rounded border border-border px-2 py-1 text-xs"
          />
        ) : (
          <p className="text-xs text-warning">
            This would exceed the required quantity — you don't have permission to override.
          </p>
        )
      ) : null}
      <button
        type="button"
        disabled={
          fetcher.state !== "idle" ||
          (Number(produced) === 0 && Number(failed) === 0 && Number(reworked) === 0) ||
          (wouldExceed && (!canOverride || overrideReason.trim().length === 0))
        }
        onClick={() => {
          const formData = new FormData();
          formData.set("_intent", "recordQuantity");
          formData.set("productionTaskId", task.id);
          formData.set("newlyProducedQuantity", produced || "0");
          formData.set("newlyFailedQuantity", failed || "0");
          formData.set("reworkedQuantity", reworked || "0");
          if (wouldExceed && overrideReason.trim()) {
            formData.set("overrideReason", overrideReason.trim());
          }
          formData.set("idempotencyKey", crypto.randomUUID());
          void fetcher.submit(formData, { method: "post", action: actionUrl });
          setProduced("0");
          setFailed("0");
          setReworked("0");
          setOverrideReason("");
        }}
        className="self-start rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
      >
        Record quantity
      </button>
      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="text-xs text-error">
          {fetcher.data.error}
        </p>
      ) : null}

      <div className="border-t border-border pt-2">
        <p className="mb-1 text-xs font-medium text-muted">
          Or scan to add 1 (informational — a task can span multiple SKUs, so the scan isn't
          validated)
        </p>
        <BarcodeScanInput
          disabled={scanFetcher.state !== "idle"}
          onScan={(scannedValue) => {
            const formData = new FormData();
            formData.set("_intent", "scanTaskQuantity");
            formData.set("productionTaskId", task.id);
            formData.set("scannedValue", scannedValue);
            void scanFetcher.submit(formData, { method: "post", action: actionUrl });
          }}
        />
        {scanFetcher.data && !scanFetcher.data.ok ? (
          <p role="alert" className="mt-1 text-xs text-error">
            {scanFetcher.data.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function QualityCheckForm({ actionUrl, task }: { actionUrl: string; task: Task }) {
  const fetcher = useFetcher<ActionResponse>();
  const checklist = getQualityChecklist(task.decorationMethod);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [checkedQuantity, setCheckedQuantity] = useState("0");
  const [approvedQuantity, setApprovedQuantity] = useState("0");
  const [failedQuantity, setFailedQuantity] = useState("0");
  const [notes, setNotes] = useState("");
  const [failureReason, setFailureReason] = useState("");

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-page p-2">
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs font-medium text-muted">Checklist</legend>
        {checklist.map((item) => (
          <label key={item.key} className="flex items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={checked[item.key] ?? false}
              onChange={(e) => {
                setChecked((prev) => ({ ...prev, [item.key]: e.target.checked }));
              }}
              className="h-3.5 w-3.5 rounded border-border"
            />
            {item.label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          Checked qty
          <input
            type="number"
            min={0}
            value={checkedQuantity}
            onChange={(e) => {
              setCheckedQuantity(e.target.value);
            }}
            className="w-24 rounded border border-border px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          Approved qty
          <input
            type="number"
            min={0}
            value={approvedQuantity}
            onChange={(e) => {
              setApprovedQuantity(e.target.value);
            }}
            className="w-24 rounded border border-border px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          Failed qty
          <input
            type="number"
            min={0}
            value={failedQuantity}
            onChange={(e) => {
              setFailedQuantity(e.target.value);
            }}
            className="w-24 rounded border border-border px-2 py-1 text-sm"
          />
        </label>
      </div>
      {Number(failedQuantity) > 0 ? (
        <input
          type="text"
          placeholder="Failure reason"
          value={failureReason}
          onChange={(e) => {
            setFailureReason(e.target.value);
          }}
          className="rounded border border-border px-2 py-1 text-xs"
        />
      ) : null}
      <textarea
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
        rows={2}
        className="rounded border border-border px-2 py-1 text-xs"
      />
      <button
        type="button"
        disabled={fetcher.state !== "idle" || Number(checkedQuantity) === 0}
        onClick={() => {
          const formData = new FormData();
          formData.set("_intent", "performQualityCheck");
          formData.set("productionTaskId", task.id);
          formData.set("checkedQuantity", checkedQuantity);
          formData.set("approvedQuantity", approvedQuantity);
          formData.set("failedQuantity", failedQuantity);
          formData.set("checklistResult", JSON.stringify(checked));
          if (notes.trim()) formData.set("notes", notes.trim());
          if (failureReason.trim()) formData.set("failureReason", failureReason.trim());
          void fetcher.submit(formData, { method: "post", action: actionUrl });
          setCheckedQuantity("0");
          setApprovedQuantity("0");
          setFailedQuantity("0");
          setNotes("");
          setFailureReason("");
        }}
        className="self-start rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
      >
        Submit quality check
      </button>
      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="text-xs text-error">
          {fetcher.data.error}
        </p>
      ) : null}
    </div>
  );
}

function IssueForm({
  actionUrl,
  productionJobId,
  productionTaskId,
}: {
  actionUrl: string;
  productionJobId: string;
  productionTaskId?: string;
}) {
  const fetcher = useFetcher<ActionResponse>();
  const [issueType, setIssueType] = useState<ProductionIssueType>("OTHER");
  const [severity, setSeverity] = useState<Severity>("MEDIUM");
  const [description, setDescription] = useState("");
  const [isBlocking, setIsBlocking] = useState(false);
  const [showForm, setShowForm] = useState(false);

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => {
          setShowForm(true);
        }}
        className="self-start text-xs text-brand-navy hover:underline"
      >
        Report an issue
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-page p-2">
      <div className="flex flex-wrap gap-2">
        <select
          value={issueType}
          onChange={(e) => {
            setIssueType(e.target.value as ProductionIssueType);
          }}
          className="rounded border border-border px-2 py-1 text-xs"
        >
          {ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {PRODUCTION_ISSUE_TYPE_LABELS[t]}
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
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
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
            className="h-3.5 w-3.5 rounded border-border"
          />
          Blocks this task
        </label>
      </div>
      <textarea
        placeholder="Describe the issue (required)"
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
            if (productionTaskId) formData.set("productionTaskId", productionTaskId);
            formData.set("issueType", issueType);
            formData.set("severity", severity);
            formData.set("description", description.trim());
            formData.set("isBlocking", isBlocking ? "true" : "false");
            void fetcher.submit(formData, { method: "post", action: actionUrl });
            setShowForm(false);
            setDescription("");
            setIsBlocking(false);
          }}
          className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
        >
          Submit issue
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

function TaskNoteForm({
  actionUrl,
  productionTaskId,
}: {
  actionUrl: string;
  productionTaskId: string;
}) {
  const fetcher = useFetcher<ActionResponse>();
  const [body, setBody] = useState("");
  return (
    <div className="mt-1 flex gap-2">
      <input
        type="text"
        placeholder="Add a note about this task…"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
        }}
        className="flex-1 rounded border border-border px-2 py-1 text-xs"
      />
      <button
        type="button"
        disabled={body.trim().length === 0 || fetcher.state !== "idle"}
        onClick={() => {
          const formData = new FormData();
          formData.set("_intent", "createNote");
          formData.set("productionTaskId", productionTaskId);
          formData.set("body", body.trim());
          void fetcher.submit(formData, { method: "post", action: actionUrl });
          setBody("");
        }}
        className="rounded-md border border-border px-2.5 py-1 text-xs text-ink disabled:opacity-50"
      >
        Add
      </button>
    </div>
  );
}

function ResolveIssueControl({ actionUrl, issueId }: { actionUrl: string; issueId: string }) {
  const fetcher = useFetcher<ActionResponse>();
  const [resolution, setResolution] = useState("");
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
        Resolve
      </button>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-1">
      <input
        type="text"
        placeholder="Resolution (required)"
        value={resolution}
        onChange={(e) => {
          setResolution(e.target.value);
        }}
        className="rounded border border-border px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={resolution.trim().length === 0 || fetcher.state !== "idle"}
          onClick={() => {
            const formData = new FormData();
            formData.set("_intent", "resolveIssue");
            formData.set("productionIssueId", issueId);
            formData.set("resolution", resolution.trim());
            void fetcher.submit(formData, { method: "post", action: actionUrl });
          }}
          className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
        >
          Confirm
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

export interface ProductionTaskCardProps {
  actionUrl: string;
  productionJobId: string;
  task: Task;
  assignableStaff: { id: string; name: string }[];
  staffNames: Record<string, string>;
  hasOpenIssue: boolean;
  canAssign: boolean;
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
}

export function ProductionTaskCard({
  actionUrl,
  productionJobId,
  task,
  assignableStaff,
  staffNames,
  hasOpenIssue,
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
}: ProductionTaskCardProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => !v);
        }}
        className="flex w-full flex-wrap items-center gap-2 p-3 text-left"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
        ) : (
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
        )}
        <span className="font-medium text-ink">
          {PRODUCTION_TASK_TYPE_LABELS[task.taskType]} — {task.proofGroup.name}
        </span>
        <Badge tone={STATUS_TONE[task.status]}>{PRODUCTION_TASK_STATUS_LABELS[task.status]}</Badge>
        {task.placement ? <span className="text-xs text-muted">{task.placement}</span> : null}
        {hasOpenIssue ? (
          <span title="Open blocking issue" className="text-warning">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            <span className="sr-only">This task has an open blocking issue</span>
          </span>
        ) : null}
        <span className="ml-auto text-xs text-muted">
          {task.completedQuantity} / {task.requiredQuantity}
        </span>
      </button>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <div className="flex items-start gap-3">
            <a
              href={`/production-artwork/${task.productionArtwork.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-border bg-page text-muted"
              aria-label={`Open ${task.productionArtwork.originalFilename}`}
            >
              {task.productionArtwork.isPreviewable ? (
                <img
                  src={`/production-artwork/${task.productionArtwork.id}/file`}
                  alt=""
                  className="h-full w-full rounded object-cover"
                />
              ) : (
                <FileIcon aria-hidden="true" className="h-6 w-6" />
              )}
            </a>
            <div className="min-w-0 flex-1 text-xs text-muted">
              <p className="text-sm text-ink">
                Revision {task.productionArtwork.revisionNumber} —{" "}
                {task.productionArtwork.originalFilename}
              </p>
              <p>Export batch item is fixed to this exact revision — never the latest.</p>
              {task.productionInstructions ? (
                <p className="mt-1">{task.productionInstructions}</p>
              ) : null}
            </div>
          </div>

          {canAssign ? (
            <AssignSection
              actionUrl={actionUrl}
              task={task}
              assignableStaff={assignableStaff}
              staffNames={staffNames}
            />
          ) : task.assignedStaffId ? (
            <p className="text-xs text-muted">
              Assigned: {staffNames[task.assignedStaffId] ?? "Unknown staff member"}
            </p>
          ) : (
            <p className="text-xs text-muted">Unassigned</p>
          )}

          <LifecycleControls
            actionUrl={actionUrl}
            task={task}
            canStart={canStart}
            canPause={canPause}
            canComplete={canComplete}
            canReopen={canReopen}
            openIssue={hasOpenIssue}
          />

          {canUpdateQuantities ? (
            <QuantityForm actionUrl={actionUrl} task={task} canOverride={canOverrideQuantities} />
          ) : null}

          {canPerformQualityCheck ? <QualityCheckForm actionUrl={actionUrl} task={task} /> : null}

          {task.qualityChecks.length > 0 ? (
            <section>
              <h5 className="text-xs font-medium text-muted">Quality check history</h5>
              <div className="mt-1 flex flex-col gap-1">
                {task.qualityChecks.map((qc) => (
                  <div key={qc.id} className="rounded border border-border px-2 py-1 text-xs">
                    <p className="text-ink">
                      Checked {qc.checkedQuantity} — approved {qc.approvedQuantity}, failed{" "}
                      {qc.failedQuantity}
                      {qc.reworkRequired ? " (rework required)" : ""}
                    </p>
                    {qc.failureReason ? <p className="text-error">{qc.failureReason}</p> : null}
                    {qc.notes ? <p className="text-muted">{qc.notes}</p> : null}
                    <p className="text-muted">
                      {staffNames[qc.checkedByStaffId] ?? "Unknown staff member"} ·{" "}
                      {formatAuDateTime(qc.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h5 className="text-xs font-medium text-muted">Issues</h5>
            <div className="mt-1 flex flex-col gap-1">
              {task.issues.length === 0 ? (
                <p className="text-xs text-muted">No issues reported for this task.</p>
              ) : (
                task.issues.map((issue) => (
                  <div key={issue.id} className="rounded border border-border px-2 py-1.5 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={ISSUE_STATUS_TONE[issue.status] ?? "neutral"}>
                        {PRODUCTION_ISSUE_STATUS_LABELS[issue.status]}
                      </Badge>
                      <span className="text-ink">
                        {PRODUCTION_ISSUE_TYPE_LABELS[issue.issueType]}
                      </span>
                      {issue.isBlocking ? <Badge tone="error">Blocking</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-ink">{issue.description}</p>
                    <p className="mt-0.5 text-muted">
                      {staffNames[issue.createdByStaffId] ?? "Unknown staff member"} ·{" "}
                      {formatAuDateTime(issue.createdAt)}
                    </p>
                    {issue.resolution ? (
                      <p className="mt-0.5 text-muted">Resolution: {issue.resolution}</p>
                    ) : null}
                    {canResolveIssues &&
                    (issue.status === "OPEN" ||
                      issue.status === "INVESTIGATING" ||
                      issue.status === "WAITING") ? (
                      <ResolveIssueControl actionUrl={actionUrl} issueId={issue.id} />
                    ) : null}
                  </div>
                ))
              )}
            </div>
            {canCreateIssues ? (
              <div className="mt-1">
                <IssueForm
                  actionUrl={actionUrl}
                  productionJobId={productionJobId}
                  productionTaskId={task.id}
                />
              </div>
            ) : null}
          </section>

          <section>
            <h5 className="text-xs font-medium text-muted">Task notes</h5>
            <div className="mt-1 flex flex-col gap-1">
              {task.notes.length === 0 ? (
                <p className="text-xs text-muted">No notes yet.</p>
              ) : (
                task.notes.map((note) => (
                  <div key={note.id} className="rounded border border-border px-2 py-1.5 text-xs">
                    <p className="whitespace-pre-wrap text-ink">{note.body}</p>
                    <p className="mt-0.5 text-muted">
                      {staffNames[note.authorStaffId] ?? "Unknown staff member"} ·{" "}
                      {formatAuDateTime(note.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
            {canCreateNotes ? (
              <TaskNoteForm actionUrl={actionUrl} productionTaskId={task.id} />
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
