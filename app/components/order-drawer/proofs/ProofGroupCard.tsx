import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { AlertTriangle, ChevronDown, ChevronRight, File as FileIcon } from "lucide-react";
import type { NoProofReason, ProofRequirementValue } from "@prisma/client";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { PriorityBadge } from "~/components/board/CardBadges";
import {
  DECORATION_METHOD_LABELS,
  NO_PROOF_REASON_LABELS,
  PROOF_GROUP_STATUS_LABELS,
  PROOF_REQUIREMENT_VALUE_LABELS,
} from "~/domain/proofs/labels";
import { formatAuDate, formatAuDateTime } from "~/lib/dates";
import { ProofVersionList } from "~/components/order-drawer/proofs/ProofVersionList";
import type { OrderDetailProofGroup } from "~/domain/proofs/proof-group-query.server";

const STATUS_TONE: Record<string, BadgeTone> = {
  NOT_STARTED: "neutral",
  DRAFT_IN_PROGRESS: "neutral",
  READY_TO_SEND: "success",
  NO_PROOF_REQUIRED: "neutral",
  CANCELLED: "error",
};

const NO_PROOF_REASONS: NoProofReason[] = [
  "UNPRINTED_PRODUCT",
  "REPEAT_JOB_PREVIOUS_ARTWORK",
  "APPROVED_STANDARD_LOGO",
  "CUSTOMER_SUPPLIED_PRODUCTION_READY",
  "INTERNAL_STAFF_ORDER",
  "OTHER",
];

type GenericActionResponse =
  { intent: string; ok: true } | { intent: string; ok: false; error: string };

export interface ProofGroupCardProps {
  orderId: string;
  group: OrderDetailProofGroup;
  availableLines: {
    id: string;
    productTitle: string;
    variantTitle: string | null;
    sku: string | null;
    quantity: number;
  }[];
  availableAssets: { id: string; label: string }[];
  assignableStaff: { id: string; name: string }[];
  canUpdate: boolean;
  canCancel: boolean;
  canUpdateRequirement: boolean;
  canCreateVersions: boolean;
  canUpdateVersionStatus: boolean;
  canAssignArtwork: boolean;
  canCreateNotes: boolean;
}

export function ProofGroupCard({
  orderId,
  group,
  availableLines,
  availableAssets,
  assignableStaff,
  canUpdate,
  canCancel,
  canUpdateRequirement,
  canCreateVersions,
  canUpdateVersionStatus,
  canAssignArtwork,
  canCreateNotes,
}: ProofGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const actionUrl = `/orders/${orderId}/proof-groups`;
  const isActive = group.status !== "CANCELLED" && group.status !== "NO_PROOF_REQUIRED";
  const linkedAssetIds = new Set(group.assets.map((a) => a.assetId));
  const linkedLineIds = new Set(group.orderLines.map((l) => l.orderLineId));
  const unlinkedLines = availableLines.filter((l) => !linkedLineIds.has(l.id));
  const unlinkedAssets = availableAssets.filter((a) => !linkedAssetIds.has(a.id));

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
        <span className="font-medium text-ink">{group.name}</span>
        <Badge tone={STATUS_TONE[group.status] ?? "neutral"}>
          {PROOF_GROUP_STATUS_LABELS[group.status]}
        </Badge>
        <Badge tone="neutral">{DECORATION_METHOD_LABELS[group.decorationMethod]}</Badge>
        {group.placement ? <span className="text-xs text-muted">{group.placement}</span> : null}
        <PriorityBadge priority={group.priority} />
        {isActive && !group.readiness.ready ? (
          <span title="Not ready to send" className="text-warning">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            <span className="sr-only">Validation warnings present</span>
          </span>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted">
          {group.assignedStaffName ? (
            <span>Assigned: {group.assignedStaffName}</span>
          ) : (
            <span>Unassigned</span>
          )}
          {group.dueDate ? <span>Due {formatAuDate(group.dueDate)}</span> : null}
          <span>{group.orderLines.length} line(s)</span>
          {group.versions[0] ? <span>v{group.versions[0].versionNumber}</span> : null}
          <span>Updated {formatAuDateTime(group.updatedAt)}</span>
        </span>
      </button>

      {expanded ? (
        <div className="flex flex-col gap-4 border-t border-border p-3">
          {!isActive ? (
            <p className="text-xs text-muted">
              {group.status === "CANCELLED"
                ? `Cancelled ${group.cancelledAt ? formatAuDateTime(group.cancelledAt) : ""} — ${group.cancelReason ?? ""}`
                : `No proof required — ${group.noProofReason ? NO_PROOF_REASON_LABELS[group.noProofReason] : ""}`}
            </p>
          ) : null}

          {isActive && group.readiness.issues.length > 0 ? (
            <div className="rounded border border-warning/40 bg-warning/5 p-2">
              <p className="text-xs font-medium text-warning">Not ready to send yet:</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-muted">
                {group.readiness.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <RequirementEditor
            actionUrl={actionUrl}
            group={group}
            canUpdateRequirement={canUpdateRequirement}
          />

          <section>
            <h5 className="text-xs font-medium text-muted">Linked order lines</h5>
            <div className="mt-1 flex flex-col gap-1">
              {group.orderLines.length === 0 ? (
                <p className="text-sm text-muted">No order lines linked yet.</p>
              ) : (
                group.orderLines.map((line) => (
                  <LineRow
                    key={line.orderLineId}
                    actionUrl={actionUrl}
                    proofGroupId={group.id}
                    line={line}
                    canUpdate={canUpdate}
                  />
                ))
              )}
            </div>
            {canUpdate && unlinkedLines.length > 0 ? (
              <LinkLineForm actionUrl={actionUrl} proofGroupId={group.id} options={unlinkedLines} />
            ) : null}
          </section>

          <section>
            <h5 className="text-xs font-medium text-muted">Linked customer uploads</h5>
            <div className="mt-1 flex flex-col gap-1">
              {group.assets.length === 0 ? (
                <p className="text-sm text-muted">No customer uploads linked yet.</p>
              ) : (
                group.assets.map((asset) => (
                  <AssetRow
                    key={asset.id}
                    actionUrl={actionUrl}
                    proofGroupId={group.id}
                    asset={asset}
                    canUpdate={canUpdate}
                  />
                ))
              )}
            </div>
            {canUpdate && unlinkedAssets.length > 0 ? (
              <LinkAssetForm
                actionUrl={actionUrl}
                proofGroupId={group.id}
                options={unlinkedAssets}
              />
            ) : null}
          </section>

          {canAssignArtwork ? (
            <AssignmentSelect
              actionUrl={actionUrl}
              group={group}
              assignableStaff={assignableStaff}
            />
          ) : null}

          <ProofVersionList
            orderId={orderId}
            proofGroupId={group.id}
            versions={group.versions}
            sourceAssetOptions={availableAssets}
            canCreateVersions={canCreateVersions && isActive}
            canUpdateStatus={canUpdateVersionStatus}
            currentVersionReadiness={group.readiness}
          />

          <ProofGroupNotesSection
            actionUrl={actionUrl}
            proofGroupId={group.id}
            notes={group.notes}
            canCreateNotes={canCreateNotes}
          />

          {canCancel && isActive ? (
            <CancelGroupSection actionUrl={actionUrl} proofGroupId={group.id} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RequirementEditor({
  actionUrl,
  group,
  canUpdateRequirement,
}: {
  actionUrl: string;
  group: OrderDetailProofGroup;
  canUpdateRequirement: boolean;
}) {
  const fetcher = useFetcher<GenericActionResponse>();
  const [target, setTarget] = useState<ProofRequirementValue>(group.requirement);
  const [noProofReason, setNoProofReason] = useState<NoProofReason | "">(group.noProofReason ?? "");
  const [noProofReasonNote, setNoProofReasonNote] = useState("");
  const [reason, setReason] = useState("");
  const response = fetcher.data;

  if (!canUpdateRequirement) {
    return (
      <div>
        <h5 className="text-xs font-medium text-muted">Proof requirement</h5>
        <p className="mt-1 text-sm text-ink">{PROOF_REQUIREMENT_VALUE_LABELS[group.requirement]}</p>
      </div>
    );
  }

  const isDirty = target !== group.requirement;
  const needsNoProofReason = target === "NOT_REQUIRED";
  const canSave =
    isDirty &&
    reason.trim().length > 0 &&
    (!needsNoProofReason ||
      (noProofReason && (noProofReason !== "OTHER" || noProofReasonNote.trim().length > 0)));

  return (
    <div>
      <h5 className="text-xs font-medium text-muted">Proof requirement</h5>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select
          value={target}
          onChange={(e) => {
            setTarget(e.target.value as ProofRequirementValue);
          }}
          className="rounded border border-border bg-page px-2 py-1.5 text-sm text-ink"
        >
          <option value="UNDETERMINED">{PROOF_REQUIREMENT_VALUE_LABELS.UNDETERMINED}</option>
          <option value="REQUIRED">{PROOF_REQUIREMENT_VALUE_LABELS.REQUIRED}</option>
          <option value="NOT_REQUIRED">{PROOF_REQUIREMENT_VALUE_LABELS.NOT_REQUIRED}</option>
        </select>
      </div>
      {isDirty ? (
        <div className="mt-2 flex flex-col gap-2 rounded border border-border bg-page p-2">
          {needsNoProofReason ? (
            <>
              <select
                value={noProofReason}
                onChange={(e) => {
                  setNoProofReason(e.target.value as NoProofReason);
                }}
                className="rounded border border-border px-2 py-1 text-sm"
              >
                <option value="" disabled>
                  Choose a reason…
                </option>
                {NO_PROOF_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {NO_PROOF_REASON_LABELS[r]}
                  </option>
                ))}
              </select>
              {noProofReason === "OTHER" ? (
                <input
                  type="text"
                  placeholder="Explain why"
                  value={noProofReasonNote}
                  onChange={(e) => {
                    setNoProofReasonNote(e.target.value);
                  }}
                  className="rounded border border-border px-2 py-1 text-sm"
                />
              ) : null}
            </>
          ) : null}
          <input
            type="text"
            placeholder={
              group.requirement === "NOT_REQUIRED"
                ? "Reason for reopening (required)"
                : "Reason (required)"
            }
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            className="rounded border border-border px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canSave || fetcher.state !== "idle"}
              onClick={() => {
                const formData = new FormData();
                formData.set("_intent", "setProofRequirement");
                formData.set("proofGroupId", group.id);
                formData.set("targetRequirement", target);
                formData.set("expectedRequirement", group.requirement);
                formData.set("noProofReason", noProofReason);
                formData.set("noProofReasonNote", noProofReasonNote);
                formData.set("reason", reason);
                void fetcher.submit(formData, { method: "post", action: actionUrl });
              }}
              className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setTarget(group.requirement);
                setReason("");
              }}
              className="rounded-md px-2.5 py-1 text-xs text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {response && !response.ok ? (
        <p role="alert" className="mt-1 text-xs text-error">
          {response.error}
        </p>
      ) : null}
    </div>
  );
}

function LineRow({
  actionUrl,
  proofGroupId,
  line,
  canUpdate,
}: {
  actionUrl: string;
  proofGroupId: string;
  line: OrderDetailProofGroup["orderLines"][number];
  canUpdate: boolean;
}) {
  const fetcher = useFetcher<GenericActionResponse>();
  return (
    <div className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-sm">
      {line.imageUrl ? (
        <img src={line.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />
      ) : (
        <span className="flex h-8 w-8 items-center justify-center rounded bg-page text-muted">
          <FileIcon aria-hidden="true" className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {line.productTitle}
        {line.variantTitle ? ` — ${line.variantTitle}` : ""} {line.sku ? `(${line.sku})` : ""} · qty{" "}
        {line.lineQuantity}
      </span>
      {canUpdate ? (
        <button
          type="button"
          disabled={fetcher.state !== "idle"}
          onClick={() => {
            const formData = new FormData();
            formData.set("_intent", "unlinkProofGroupLine");
            formData.set("proofGroupId", proofGroupId);
            formData.set("orderLineId", line.orderLineId);
            void fetcher.submit(formData, { method: "post", action: actionUrl });
          }}
          className="text-xs text-brand-navy hover:underline"
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}

function LinkLineForm({
  actionUrl,
  proofGroupId,
  options,
}: {
  actionUrl: string;
  proofGroupId: string;
  options: {
    id: string;
    productTitle: string;
    variantTitle: string | null;
    sku: string | null;
    quantity: number;
  }[];
}) {
  const fetcher = useFetcher<GenericActionResponse>();
  const [selected, setSelected] = useState("");
  return (
    <div className="mt-1 flex gap-2">
      <select
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
        }}
        className="flex-1 rounded border border-border bg-page px-2 py-1 text-sm text-ink"
      >
        <option value="">Add a line…</option>
        {options.map((line) => (
          <option key={line.id} value={line.id}>
            {line.productTitle}
            {line.variantTitle ? ` — ${line.variantTitle}` : ""} {line.sku ? `(${line.sku})` : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!selected || fetcher.state !== "idle"}
        onClick={() => {
          const formData = new FormData();
          formData.set("_intent", "linkProofGroupLine");
          formData.set("proofGroupId", proofGroupId);
          formData.set("orderLineId", selected);
          void fetcher.submit(formData, { method: "post", action: actionUrl });
          setSelected("");
        }}
        className="rounded-md border border-border px-2.5 py-1 text-xs text-ink disabled:opacity-50"
      >
        Add
      </button>
    </div>
  );
}

function AssetRow({
  actionUrl,
  proofGroupId,
  asset,
  canUpdate,
}: {
  actionUrl: string;
  proofGroupId: string;
  asset: OrderDetailProofGroup["assets"][number];
  canUpdate: boolean;
}) {
  const fetcher = useFetcher<GenericActionResponse>();
  return (
    <div className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-sm">
      <FileIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate">
        {asset.originalFilename ?? asset.sourceUrl ?? "Untitled file"}
      </span>
      {asset.parsingUncertain ? (
        <span className="text-xs text-warning">Parsing uncertain</span>
      ) : null}
      {canUpdate ? (
        <button
          type="button"
          disabled={fetcher.state !== "idle"}
          onClick={() => {
            const formData = new FormData();
            formData.set("_intent", "unlinkProofGroupAsset");
            formData.set("proofGroupId", proofGroupId);
            formData.set("assetId", asset.assetId);
            void fetcher.submit(formData, { method: "post", action: actionUrl });
          }}
          className="text-xs text-brand-navy hover:underline"
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}

function LinkAssetForm({
  actionUrl,
  proofGroupId,
  options,
}: {
  actionUrl: string;
  proofGroupId: string;
  options: { id: string; label: string }[];
}) {
  const fetcher = useFetcher<GenericActionResponse>();
  const [selected, setSelected] = useState("");
  return (
    <div className="mt-1 flex gap-2">
      <select
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
        }}
        className="flex-1 rounded border border-border bg-page px-2 py-1 text-sm text-ink"
      >
        <option value="">Link an upload…</option>
        {options.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!selected || fetcher.state !== "idle"}
        onClick={() => {
          const formData = new FormData();
          formData.set("_intent", "linkProofGroupAsset");
          formData.set("proofGroupId", proofGroupId);
          formData.set("assetId", selected);
          void fetcher.submit(formData, { method: "post", action: actionUrl });
          setSelected("");
        }}
        className="rounded-md border border-border px-2.5 py-1 text-xs text-ink disabled:opacity-50"
      >
        Add
      </button>
    </div>
  );
}

function AssignmentSelect({
  actionUrl,
  group,
  assignableStaff,
}: {
  actionUrl: string;
  group: OrderDetailProofGroup;
  assignableStaff: { id: string; name: string }[];
}) {
  const fetcher = useFetcher<GenericActionResponse>();
  const [prevStaffId, setPrevStaffId] = useState(group.assignedStaffId);
  const [selected, setSelected] = useState(group.assignedStaffId ?? "");
  if (group.assignedStaffId !== prevStaffId) {
    setPrevStaffId(group.assignedStaffId);
    setSelected(group.assignedStaffId ?? "");
  }
  const response = fetcher.data;

  return (
    <div>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Assigned artwork staff (this group only)
        <select
          value={selected}
          disabled={fetcher.state !== "idle"}
          onChange={(e) => {
            const value = e.target.value;
            setSelected(value);
            const formData = new FormData();
            formData.set("_intent", "assignProofGroup");
            formData.set("proofGroupId", group.id);
            formData.set("targetStaffUserId", value);
            formData.set("expectedStaffUserId", group.assignedStaffId ?? "");
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
      {response && !response.ok ? (
        <p role="alert" className="mt-1 text-xs text-error">
          {response.error}
        </p>
      ) : null}
    </div>
  );
}

function ProofGroupNotesSection({
  actionUrl,
  proofGroupId,
  notes,
  canCreateNotes,
}: {
  actionUrl: string;
  proofGroupId: string;
  notes: OrderDetailProofGroup["notes"];
  canCreateNotes: boolean;
}) {
  const fetcher = useFetcher<GenericActionResponse>();
  const formRefKey = notes.length;
  const [body, setBody] = useState("");

  return (
    <section>
      <h5 className="text-xs font-medium text-muted">Internal artwork notes</h5>
      <div className="mt-1 flex flex-col gap-1">
        {notes.length === 0 ? (
          <p className="text-sm text-muted">No notes yet.</p>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="rounded border border-border px-2 py-1.5 text-sm">
              <p className="whitespace-pre-wrap text-ink">{note.body}</p>
              <p className="mt-0.5 text-xs text-muted">
                {note.authorStaffName} · {formatAuDateTime(note.createdAt)}
              </p>
            </div>
          ))
        )}
      </div>
      {canCreateNotes ? (
        <div className="mt-1 flex gap-2" key={formRefKey}>
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
              formData.set("_intent", "addProofNote");
              formData.set("proofGroupId", proofGroupId);
              formData.set("body", body);
              void fetcher.submit(formData, { method: "post", action: actionUrl });
              setBody("");
            }}
            className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
          >
            Add
          </button>
        </div>
      ) : null}
    </section>
  );
}

function CancelGroupSection({
  actionUrl,
  proofGroupId,
}: {
  actionUrl: string;
  proofGroupId: string;
}) {
  const fetcher = useFetcher<GenericActionResponse>();
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");
  const response = fetcher.data;

  /* eslint-disable react-hooks/set-state-in-effect -- reacting to an async fetch completing
     (an external system), not mirroring a prop into state. */
  useEffect(() => {
    if (fetcher.state === "idle" && response?.ok) {
      setShowForm(false);
      setReason("");
    }
  }, [fetcher.state, response]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => {
          setShowForm(true);
        }}
        className="self-start text-xs text-error hover:underline"
      >
        Cancel this proof group
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
            formData.set("_intent", "cancelProofGroup");
            formData.set("proofGroupId", proofGroupId);
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
      {response && !response.ok ? (
        <p role="alert" className="text-xs text-error">
          {response.error}
        </p>
      ) : null}
    </div>
  );
}
