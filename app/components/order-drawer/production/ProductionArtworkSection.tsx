import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { File as FileIcon } from "lucide-react";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { PRODUCTION_ARTWORK_STATUS_LABELS } from "~/domain/production/labels";
import { evaluateReadyForExportEligibility } from "~/domain/production/eligibility";
import { formatAuDateTime } from "~/lib/dates";
import type { OrderDetailProductionArtwork } from "~/domain/proofs/proof-group-query.server";

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  VALIDATION_FAILED: "warning",
  READY_FOR_EXPORT: "success",
  EXPORTED: "success",
  SUPERSEDED: "neutral",
  CANCELLED: "error",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ArtworkActionResponse =
  | { intent: string; ok: true; issues?: string[] }
  | { intent: string; ok: false; error: string; issues?: string[] };

function LineAllocationEditor({
  orderId,
  artwork,
  lineOptions,
  onDone,
}: {
  orderId: string;
  artwork: OrderDetailProductionArtwork;
  lineOptions: { id: string; label: string; quantity: number }[];
  onDone: () => void;
}) {
  const fetcher = useFetcher<ArtworkActionResponse>();
  const allocatedByLine = new Map(
    artwork.orderLineAllocations.map((a) => [a.orderLineId, a.quantity]),
  );
  const [selected, setSelected] = useState<Record<string, number>>(
    Object.fromEntries(lineOptions.map((l) => [l.id, allocatedByLine.get(l.id) ?? 0])),
  );
  const response = fetcher.data;

  useEffect(() => {
    if (fetcher.state === "idle" && response?.ok) {
      onDone();
    }
  }, [fetcher.state, response, onDone]);

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-page p-2">
      {lineOptions.map((line) => (
        <label key={line.id} className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={(selected[line.id] ?? 0) > 0}
            onChange={(e) => {
              setSelected((prev) => ({ ...prev, [line.id]: e.target.checked ? line.quantity : 0 }));
            }}
          />
          {line.label}
          {(selected[line.id] ?? 0) > 0 ? (
            <input
              type="number"
              min={1}
              max={line.quantity}
              value={selected[line.id]}
              onChange={(e) => {
                setSelected((prev) => ({ ...prev, [line.id]: Number(e.target.value) }));
              }}
              className="w-16 rounded border border-border px-1 py-0.5 text-xs"
            />
          ) : null}
        </label>
      ))}
      {response && !response.ok ? (
        <p role="alert" className="text-xs text-error">
          {response.error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={fetcher.state !== "idle"}
          onClick={() => {
            const formData = new FormData();
            formData.set("_intent", "setProductionArtworkOrderLines");
            formData.set("productionArtworkId", artwork.id);
            for (const [orderLineId, quantity] of Object.entries(selected)) {
              if (quantity > 0) {
                formData.append("orderLineId", orderLineId);
                formData.append("quantity", String(quantity));
              }
            }
            void fetcher.submit(formData, {
              method: "post",
              action: `/orders/${orderId}/production-artwork`,
            });
          }}
          className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
        >
          Save allocation
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

function ArtworkRevisionRow({
  orderId,
  artwork,
  isCurrent,
  lineOptions,
  canUpdate,
  canCancel,
}: {
  orderId: string;
  artwork: OrderDetailProductionArtwork;
  isCurrent: boolean;
  lineOptions: { id: string; label: string; quantity: number }[];
  canUpdate: boolean;
  canCancel: boolean;
}) {
  const fetcher = useFetcher<ArtworkActionResponse>();
  const [showAllocation, setShowAllocation] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const response = fetcher.data;
  const actionUrl = `/orders/${orderId}/production-artwork`;

  const readyEligibility = evaluateReadyForExportEligibility({
    artworkStatus: artwork.status,
    validationStatus: artwork.validationStatus,
    hasStoredFile: true,
    allocatedLineCount: artwork.orderLineAllocations.length,
  });

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start gap-3">
        <a
          href={`/production-artwork/${artwork.id}/file`}
          target="_blank"
          rel="noreferrer"
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-border bg-page text-muted"
          aria-label={`Open ${artwork.originalFilename}`}
        >
          <FileIcon aria-hidden="true" className="h-6 w-6" />
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-ink">Revision {artwork.revisionNumber}</p>
            <Badge tone={STATUS_TONE[artwork.status] ?? "neutral"}>
              {PRODUCTION_ARTWORK_STATUS_LABELS[artwork.status]}
            </Badge>
            {isCurrent ? <Badge tone="neutral">Current</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {artwork.createdByStaffName} · {formatAuDateTime(artwork.createdAt)}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {artwork.originalFilename} · {formatSize(artwork.sizeBytes)}
            {artwork.width && artwork.height ? ` · ${artwork.width}×${artwork.height}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {artwork.orderLineAllocations.length === 0
              ? "No order lines allocated"
              : artwork.orderLineAllocations
                  .map((a) => `${a.productTitle} ×${a.quantity}`)
                  .join(", ")}
          </p>
          {!artwork.validationStatus && artwork.validationMessages.length > 0 ? (
            <ul className="mt-1 list-disc pl-4 text-xs text-warning">
              {artwork.validationMessages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
          {artwork.cancelledAt ? (
            <p className="mt-1 text-xs text-error">
              Cancelled {formatAuDateTime(artwork.cancelledAt)}
              {artwork.cancelReason ? ` — ${artwork.cancelReason}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {canUpdate &&
      isCurrent &&
      (artwork.status === "DRAFT" || artwork.status === "VALIDATION_FAILED") ? (
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          {!readyEligibility.eligible ? (
            <ul className="list-disc pl-4 text-xs text-warning">
              {readyEligibility.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setShowAllocation((v) => !v);
              }}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-ink"
            >
              Allocate order lines
            </button>
            <button
              type="button"
              disabled={!readyEligibility.eligible || fetcher.state !== "idle"}
              onClick={() => {
                const formData = new FormData();
                formData.set("_intent", "markProductionArtworkReady");
                formData.set("productionArtworkId", artwork.id);
                void fetcher.submit(formData, { method: "post", action: actionUrl });
              }}
              className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
            >
              Mark ready for export
            </button>
            {canCancel ? (
              <button
                type="button"
                onClick={() => {
                  setShowCancelForm((v) => !v);
                }}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-ink"
              >
                Cancel revision
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showAllocation ? (
        <div className="mt-2">
          <LineAllocationEditor
            orderId={orderId}
            artwork={artwork}
            lineOptions={lineOptions}
            onDone={() => {
              setShowAllocation(false);
            }}
          />
        </div>
      ) : null}

      {showCancelForm ? (
        <div className="mt-2 flex flex-col gap-1 rounded border border-border bg-page p-2">
          <input
            type="text"
            placeholder="Reason for cancelling (required)"
            value={cancelReason}
            onChange={(e) => {
              setCancelReason(e.target.value);
            }}
            className="rounded border border-border px-2 py-1 text-xs"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={cancelReason.trim().length === 0 || fetcher.state !== "idle"}
              onClick={() => {
                const formData = new FormData();
                formData.set("_intent", "cancelProductionArtwork");
                formData.set("productionArtworkId", artwork.id);
                formData.set("reason", cancelReason);
                void fetcher.submit(formData, { method: "post", action: actionUrl });
              }}
              className="rounded-md bg-error px-2.5 py-1 text-xs text-white disabled:opacity-50"
            >
              Confirm cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCancelForm(false);
              }}
              className="rounded-md px-2.5 py-1 text-xs text-muted"
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {response && !response.ok ? (
        <p role="alert" className="mt-2 text-xs text-error">
          {response.error}
        </p>
      ) : null}
    </div>
  );
}

function UploadArtworkForm({ orderId, proofGroupId }: { orderId: string; proofGroupId: string }) {
  const fetcher = useFetcher<ArtworkActionResponse>();
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

  return (
    <fetcher.Form
      ref={formRef}
      method="post"
      action={`/orders/${orderId}/production-artwork`}
      encType="multipart/form-data"
      className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3"
    >
      <input type="hidden" name="_intent" value="createProductionArtwork" />
      <input type="hidden" name="proofGroupId" value={proofGroupId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Production artwork file (PDF, PNG, TIFF, SVG, EPS, AI, or EMB, up to 100MB)
        <input
          type="file"
          name="file"
          accept=".pdf,.png,.tif,.tiff,.svg,.eps,.ai,.emb"
          required
          className="text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Placement (optional)
        <input
          type="text"
          name="placement"
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
        Upload production artwork
      </button>
    </fetcher.Form>
  );
}

export interface ProductionArtworkSectionProps {
  orderId: string;
  proofGroupId: string;
  artworks: OrderDetailProductionArtwork[];
  lineOptions: { id: string; label: string; quantity: number }[];
  canCreate: boolean;
  canUpdate: boolean;
  canCancel: boolean;
}

export function ProductionArtworkSection({
  orderId,
  proofGroupId,
  artworks,
  lineOptions,
  canCreate,
  canUpdate,
  canCancel,
}: ProductionArtworkSectionProps) {
  const current = artworks[0] ?? null;

  return (
    <div className="flex flex-col gap-2">
      <h5 className="text-xs font-medium text-muted">Production artwork</h5>
      {artworks.length === 0 ? (
        <p className="text-sm text-muted">No production artwork prepared yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {artworks.map((artwork) => (
            <ArtworkRevisionRow
              key={artwork.id}
              orderId={orderId}
              artwork={artwork}
              isCurrent={artwork.id === current?.id}
              lineOptions={lineOptions}
              canUpdate={canUpdate}
              canCancel={canCancel}
            />
          ))}
        </div>
      )}
      {canCreate ? <UploadArtworkForm orderId={orderId} proofGroupId={proofGroupId} /> : null}
    </div>
  );
}
