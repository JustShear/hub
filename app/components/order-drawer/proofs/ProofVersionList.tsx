import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { File as FileIcon } from "lucide-react";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { PROOF_VERSION_STATUS_LABELS } from "~/domain/proofs/labels";
import { formatAuDateTime } from "~/lib/dates";
import type { OrderDetailProofVersion } from "~/domain/proofs/proof-group-query.server";

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  READY_TO_SEND: "success",
  SUPERSEDED: "neutral",
  CANCELLED: "error",
};

function isImageMime(mimeType: string | null): boolean {
  return mimeType === "image/png" || mimeType === "image/jpeg";
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface VersionRowProps {
  orderId: string;
  version: OrderDetailProofVersion;
  canUpdateStatus: boolean;
  isReadyForVersion: boolean;
  readinessIssues: string[];
}

type VersionActionResponse =
  | { intent: "markProofVersionReady" | "cancelProofVersion"; ok: true }
  | {
      intent: "markProofVersionReady" | "cancelProofVersion";
      ok: false;
      error: string;
      issues?: string[];
    };

function VersionRow({
  orderId,
  version,
  canUpdateStatus,
  isReadyForVersion,
  readinessIssues,
}: VersionRowProps) {
  const fetcher = useFetcher<VersionActionResponse>();
  const [showCancelForm, setShowCancelForm] = useState(false);
  const primaryAsset = version.assets.find((a) => a.isPrimary) ?? version.assets[0] ?? null;
  const response = fetcher.data;
  const actionUrl = `/orders/${orderId}/proof-groups`;

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start gap-3">
        {primaryAsset ? (
          isImageMime(primaryAsset.mimeType) ? (
            <img
              src={`/proof-assets/${primaryAsset.id}`}
              alt={`Version ${version.versionNumber} preview`}
              loading="lazy"
              className="h-16 w-16 shrink-0 rounded border border-border object-cover"
            />
          ) : (
            <a
              href={`/proof-assets/${primaryAsset.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-border bg-page text-muted"
              aria-label={`Open ${primaryAsset.originalFilename ?? "proof file"}`}
            >
              <FileIcon aria-hidden="true" className="h-6 w-6" />
            </a>
          )
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-border bg-page text-muted">
            <FileIcon aria-hidden="true" className="h-6 w-6" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-ink">Version {version.versionNumber}</p>
            <Badge tone={STATUS_TONE[version.status] ?? "neutral"}>
              {PROOF_VERSION_STATUS_LABELS[version.status]}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {version.createdByStaffName} · {formatAuDateTime(version.createdAt)}
          </p>
          {primaryAsset ? (
            <p className="mt-0.5 text-xs text-muted">
              {primaryAsset.originalFilename ?? "Untitled file"} ·{" "}
              {formatSize(primaryAsset.sizeBytes)}
              {primaryAsset.width && primaryAsset.height
                ? ` · ${primaryAsset.width}×${primaryAsset.height}`
                : ""}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-warning">No stored proof file</p>
          )}
          {version.internalNote ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{version.internalNote}</p>
          ) : null}
          {version.cancelledAt ? (
            <p className="mt-1 text-xs text-error">
              Cancelled {formatAuDateTime(version.cancelledAt)}
              {version.cancelReason ? ` — ${version.cancelReason}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {canUpdateStatus && version.status === "DRAFT" ? (
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          {!isReadyForVersion && readinessIssues.length > 0 ? (
            <ul className="list-disc pl-4 text-xs text-warning">
              {readinessIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!isReadyForVersion || fetcher.state !== "idle"}
              onClick={() => {
                const formData = new FormData();
                formData.set("_intent", "markProofVersionReady");
                formData.set("proofVersionId", version.id);
                void fetcher.submit(formData, { method: "post", action: actionUrl });
              }}
              className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white disabled:opacity-50"
            >
              Mark ready to send
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCancelForm((v) => !v);
              }}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-ink"
            >
              Cancel version
            </button>
          </div>
          {showCancelForm ? (
            <CancelVersionForm
              actionUrl={actionUrl}
              proofVersionId={version.id}
              onDone={() => {
                setShowCancelForm(false);
              }}
            />
          ) : null}
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

function CancelVersionForm({
  actionUrl,
  proofVersionId,
  onDone,
}: {
  actionUrl: string;
  proofVersionId: string;
  onDone: () => void;
}) {
  const fetcher = useFetcher<VersionActionResponse>();
  const [reason, setReason] = useState("");
  const response = fetcher.data;

  useEffect(() => {
    if (fetcher.state === "idle" && response?.ok) {
      onDone();
    }
  }, [fetcher.state, response, onDone]);

  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-page p-2">
      <input
        type="text"
        placeholder="Reason for cancelling (required)"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
        className="rounded border border-border px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={reason.trim().length === 0 || fetcher.state !== "idle"}
          onClick={() => {
            const formData = new FormData();
            formData.set("_intent", "cancelProofVersion");
            formData.set("proofVersionId", proofVersionId);
            formData.set("reason", reason);
            void fetcher.submit(formData, { method: "post", action: actionUrl });
          }}
          className="rounded-md bg-error px-2.5 py-1 text-xs text-white disabled:opacity-50"
        >
          Confirm cancel
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-2.5 py-1 text-xs text-muted"
        >
          Back
        </button>
      </div>
    </div>
  );
}

type CreateVersionResponse =
  | { intent: "createProofVersion"; ok: true }
  | { intent: "createProofVersion"; ok: false; error: string };

function CreateProofVersionForm({
  orderId,
  proofGroupId,
  sourceAssetOptions,
}: {
  orderId: string;
  proofGroupId: string;
  sourceAssetOptions: { id: string; label: string }[];
}) {
  const fetcher = useFetcher<CreateVersionResponse>();
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
      action={`/orders/${orderId}/proof-groups`}
      encType="multipart/form-data"
      className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3"
    >
      <input type="hidden" name="_intent" value="createProofVersion" />
      <input type="hidden" name="proofGroupId" value={proofGroupId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        New proof file (PDF, PNG, or JPEG, up to 25MB)
        <input
          type="file"
          name="file"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          required
          className="text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Internal note (optional)
        <textarea
          name="internalNote"
          rows={2}
          className="rounded border border-border px-2 py-1.5 text-sm text-ink"
        />
      </label>
      {sourceAssetOptions.length > 0 ? (
        <fieldset className="rounded border border-border p-2">
          <legend className="px-1 text-xs font-medium text-muted">
            Source assets used (optional)
          </legend>
          <div className="flex max-h-24 flex-col gap-1 overflow-y-auto">
            {sourceAssetOptions.map((asset) => (
              <label key={asset.id} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="sourceAssetId" value={asset.id} />
                {asset.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {response && !response.ok ? (
        <p role="alert" className="text-xs text-error">
          {response.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={fetcher.state !== "idle"}
        className="self-start rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        Upload new version
      </button>
    </fetcher.Form>
  );
}

export interface ProofVersionListProps {
  orderId: string;
  proofGroupId: string;
  versions: OrderDetailProofVersion[];
  sourceAssetOptions: { id: string; label: string }[];
  canCreateVersions: boolean;
  canUpdateStatus: boolean;
  currentVersionReadiness: { ready: boolean; issues: string[] };
}

export function ProofVersionList({
  orderId,
  proofGroupId,
  versions,
  sourceAssetOptions,
  canCreateVersions,
  canUpdateStatus,
  currentVersionReadiness,
}: ProofVersionListProps) {
  const latestVersion = versions[0] ?? null;

  return (
    <div className="flex flex-col gap-2">
      <h5 className="text-xs font-medium text-muted">Version history</h5>
      {versions.length === 0 ? (
        <p className="text-sm text-muted">No proof versions yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {versions.map((version) => (
            <VersionRow
              key={version.id}
              orderId={orderId}
              version={version}
              canUpdateStatus={canUpdateStatus}
              isReadyForVersion={version.id === latestVersion?.id && currentVersionReadiness.ready}
              readinessIssues={
                version.id === latestVersion?.id ? currentVersionReadiness.issues : []
              }
            />
          ))}
        </div>
      )}
      {canCreateVersions ? (
        <CreateProofVersionForm
          orderId={orderId}
          proofGroupId={proofGroupId}
          sourceAssetOptions={sourceAssetOptions}
        />
      ) : null}
    </div>
  );
}
