import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { EXPORT_BATCH_STATUS_LABELS } from "~/domain/production/labels";
import { formatAuDateTime } from "~/lib/dates";
import type { OrderDetailExportBatch } from "~/domain/production/export-batch-query.server";

const STATUS_TONE: Record<string, BadgeTone> = {
  PREPARING: "neutral",
  READY: "neutral",
  EXPORTED: "success",
  FAILED: "error",
  SUPERSEDED: "neutral",
  CANCELLED: "error",
};

type ExportActionResponse =
  | { intent: string; ok: true; exportBatchId?: string; batchNumber?: number }
  | { intent: string; ok: false; error: string; issues?: string[] };

function CreateExportBatchForm({
  orderId,
  eligibleGroups,
}: {
  orderId: string;
  eligibleGroups: { id: string; name: string }[];
}) {
  const fetcher = useFetcher<ExportActionResponse>();
  const formRef = useRef<HTMLFormElement>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const response = fetcher.data;

  /* eslint-disable react-hooks/set-state-in-effect -- reacting to an async fetch completing
     (an external system), not mirroring a prop into state. */
  useEffect(() => {
    if (fetcher.state === "idle" && response?.ok) {
      formRef.current?.reset();
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [fetcher.state, response]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (eligibleGroups.length === 0) {
    return (
      <p className="text-xs text-muted">
        No proof groups currently have production artwork marked ready for export.
      </p>
    );
  }

  return (
    <fetcher.Form
      ref={formRef}
      method="post"
      action={`/orders/${orderId}/production-artwork`}
      className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3"
    >
      <input type="hidden" name="_intent" value="createExportBatch" />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <fieldset className="rounded border border-border p-2">
        <legend className="px-1 text-xs font-medium text-muted">
          Proof groups to export (each independently)
        </legend>
        <div className="flex flex-col gap-1">
          {eligibleGroups.map((group) => (
            <label key={group.id} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="proofGroupId" value={group.id} defaultChecked />
              {group.name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Destination (optional)
        <input
          type="text"
          name="destination"
          placeholder="e.g. Embroidery vendor via email"
          className="rounded border border-border px-2 py-1.5 text-sm"
        />
      </label>
      {response && !response.ok ? (
        <div>
          <p role="alert" className="text-xs text-error">
            {response.error}
          </p>
          {response.issues ? (
            <ul className="list-disc pl-4 text-xs text-error">
              {response.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={fetcher.state !== "idle"}
        className="self-start rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        Export for print
      </button>
    </fetcher.Form>
  );
}

function ReExportForm({
  orderId,
  batch,
  eligibleGroupIds,
  onDone,
}: {
  orderId: string;
  batch: OrderDetailExportBatch;
  eligibleGroupIds: string[];
  onDone: () => void;
}) {
  const fetcher = useFetcher<ExportActionResponse>();
  const [reason, setReason] = useState("");
  const response = fetcher.data;

  useEffect(() => {
    if (fetcher.state === "idle" && response?.ok) {
      onDone();
    }
  }, [fetcher.state, response, onDone]);

  return (
    <div className="mt-2 flex flex-col gap-1 rounded border border-border bg-page p-2">
      <input
        type="text"
        placeholder="Reason for re-export (required)"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
        className="rounded border border-border px-2 py-1 text-xs"
      />
      {response && !response.ok ? (
        <p role="alert" className="text-xs text-error">
          {response.error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={reason.trim().length === 0 || fetcher.state !== "idle"}
          onClick={() => {
            const formData = new FormData();
            formData.set("_intent", "reExportBatch");
            formData.set("idempotencyKey", crypto.randomUUID());
            formData.set("reexportReason", reason);
            if (batch.destination) formData.set("destination", batch.destination);
            for (const item of batch.items) {
              if (eligibleGroupIds.includes(item.proofGroupId)) {
                formData.append("proofGroupId", item.proofGroupId);
              }
            }
            void fetcher.submit(formData, {
              method: "post",
              action: `/orders/${orderId}/production-artwork`,
            });
          }}
          className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
        >
          Confirm re-export
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-2.5 py-1 text-xs text-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ExportBatchRow({
  orderId,
  batch,
  eligibleGroupIds,
  canDownload,
  canReexport,
}: {
  orderId: string;
  batch: OrderDetailExportBatch;
  eligibleGroupIds: string[];
  canDownload: boolean;
  canReexport: boolean;
}) {
  const [showReexport, setShowReexport] = useState(false);
  const reexportableItemIds = batch.items
    .map((i) => i.proofGroupId)
    .filter((id) => eligibleGroupIds.includes(id));

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-ink">Batch {batch.batchNumber}</p>
        <Badge tone={STATUS_TONE[batch.status] ?? "neutral"}>
          {EXPORT_BATCH_STATUS_LABELS[batch.status]}
        </Badge>
        {batch.previousBatchId ? <Badge tone="neutral">Re-export</Badge> : null}
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {batch.createdByStaffName} · {formatAuDateTime(batch.createdAt)}
        {batch.exportedAt ? ` · exported ${formatAuDateTime(batch.exportedAt)}` : ""}
      </p>
      {batch.destination ? (
        <p className="mt-0.5 text-xs text-muted">Destination: {batch.destination}</p>
      ) : null}
      <p className="mt-1 text-xs text-ink">
        {batch.items.map((item) => item.proofGroupName).join(", ")}
      </p>
      {batch.reexportReason ? (
        <p className="mt-1 text-xs text-muted">Re-export reason: {batch.reexportReason}</p>
      ) : null}
      {batch.cancelReason ? <p className="mt-1 text-xs text-error">{batch.cancelReason}</p> : null}
      {batch.downloadCount > 0 ? (
        <p className="mt-0.5 text-xs text-muted">
          Downloaded {batch.downloadCount} time{batch.downloadCount === 1 ? "" : "s"}
          {batch.lastDownloadedAt ? ` · last ${formatAuDateTime(batch.lastDownloadedAt)}` : ""}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {canDownload && batch.hasPackage ? (
          <a
            href={`/export-batches/${batch.id}/package`}
            className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white"
          >
            Download package
          </a>
        ) : null}
        {canReexport && batch.status === "EXPORTED" && reexportableItemIds.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setShowReexport((v) => !v);
            }}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-ink"
          >
            Re-export
          </button>
        ) : null}
      </div>
      {showReexport ? (
        <ReExportForm
          orderId={orderId}
          batch={batch}
          eligibleGroupIds={reexportableItemIds}
          onDone={() => {
            setShowReexport(false);
          }}
        />
      ) : null}
    </div>
  );
}

export interface ExportBatchSectionProps {
  orderId: string;
  batches: OrderDetailExportBatch[];
  eligibleGroups: { id: string; name: string }[];
  canCreate: boolean;
  canDownload: boolean;
  canReexport: boolean;
}

export function ExportBatchSection({
  orderId,
  batches,
  eligibleGroups,
  canCreate,
  canDownload,
  canReexport,
}: ExportBatchSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-ink">Export batches</h4>
      {batches.length === 0 ? (
        <p className="text-sm text-muted">No export batches yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {batches.map((batch) => (
            <ExportBatchRow
              key={batch.id}
              orderId={orderId}
              batch={batch}
              eligibleGroupIds={eligibleGroups.map((g) => g.id)}
              canDownload={canDownload}
              canReexport={canReexport}
            />
          ))}
        </div>
      )}
      {canCreate ? (
        <CreateExportBatchForm orderId={orderId} eligibleGroups={eligibleGroups} />
      ) : null}
    </section>
  );
}
