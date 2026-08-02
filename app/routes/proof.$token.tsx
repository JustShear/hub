import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { Route } from "./+types/proof.$token";
import { resolveProofRequestByToken } from "~/auth/proof-token.server";
import {
  loadCustomerProofPortalData,
  type CustomerProofPortalGroup,
} from "~/domain/proofs/proof-portal-query.server";
import {
  DECORATION_METHOD_LABELS,
  PROOF_APPROVAL_ACKNOWLEDGEMENT_TEXT,
} from "~/domain/proofs/labels";

type LoaderData =
  | { valid: false; reason: "not_found" | "expired" | "revoked" }
  | { valid: true; token: string; data: Awaited<ReturnType<typeof loadCustomerProofPortalData>> };

// GET-only — never approves, rejects, or otherwise mutates anything. The
// separate "view" recording happens from a client-side effect below, via a
// POST to proof.$token.respond.tsx, specifically so a mail-security scanner
// following this link (which only ever issues a GET) can't register a view.
export async function loader({ params }: Route.LoaderArgs): Promise<LoaderData> {
  const resolved = await resolveProofRequestByToken(params.token);
  if (resolved.outcome !== "valid") {
    return {
      valid: false,
      reason: resolved.outcome === "not_found" ? "not_found" : resolved.outcome,
    };
  }
  const data = await loadCustomerProofPortalData(resolved.proofRequest.id);
  return { valid: true, token: params.token, data };
}

export function headers() {
  return new Headers({
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    // No third-party scripts of any kind on a tokenised customer page —
    // only same-origin styles/scripts/images are ever allowed to load.
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
  });
}

export default function ProofPortalPage({ loaderData }: Route.ComponentProps) {
  if (!loaderData.valid) {
    return <InvalidLinkScreen reason={loaderData.reason} />;
  }

  return <ProofPortal token={loaderData.token} data={loaderData.data} />;
}

function InvalidLinkScreen({ reason }: { reason: "not_found" | "expired" | "revoked" }) {
  const message =
    reason === "expired"
      ? "This proof link has expired. Please contact Just Shear and we'll send you a fresh one."
      : reason === "revoked"
        ? "This proof link is no longer active. Please contact Just Shear if you still need to review your artwork."
        : "This proof link isn't valid. Please check the link or contact Just Shear for help.";

  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 text-center shadow-sm">
        <img src="/logo.png" alt="Just Shear" className="mx-auto h-10 w-auto" />
        <p className="mt-4 text-ink">{message}</p>
      </div>
    </main>
  );
}

function ProofPortal({
  token,
  data,
}: {
  token: string;
  data: Awaited<ReturnType<typeof loadCustomerProofPortalData>>;
}) {
  const viewFetcher = useFetcher();

  useEffect(() => {
    // Fires once the portal has genuinely rendered in a browser — this is
    // the "safe client event" the view-tracking design relies on, not the
    // page's own GET.
    void viewFetcher.submit(
      { _intent: "view" },
      { method: "post", action: `/proof/${token}/respond` },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire exactly once on mount
  }, []);

  const resolvedCount = data.groups.filter((g) => g.responseStatus !== "AWAITING_RESPONSE").length;

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-page px-4 py-8 sm:px-6">
      <header className="mb-6">
        <img src="/logo.png" alt="Just Shear" className="h-8 w-auto" />
        <h1 className="mt-3 text-xl font-semibold text-ink">
          Your artwork proof{data.groups.length === 1 ? "" : "s"} — Order {data.orderNumber}
        </h1>
        {data.customerName ? (
          <p className="mt-1 text-ink">Hi {data.customerName.split(" ")[0]},</p>
        ) : null}
        <p className="mt-2 text-sm text-muted">
          Please check spelling, colours, placement and every detail carefully. Production will only
          proceed once every required proof below has been approved.
        </p>
        {data.staffMessage ? (
          <p className="mt-3 rounded-md border border-border bg-surface p-3 text-sm text-ink">
            {data.staffMessage}
          </p>
        ) : null}
        <p className="mt-3 text-sm font-medium text-ink" role="status">
          {resolvedCount} of {data.groups.length} reviewed
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {data.groups.map((group) => (
          <ProofGroupCard key={group.proofGroupId} token={token} group={group} />
        ))}
      </div>

      <footer className="mt-10 border-t border-border pt-4 text-sm text-muted">
        <p>
          Questions about your artwork? Reply to the email that sent you this link, or contact Just
          Shear directly — we're happy to help.
        </p>
      </footer>
    </main>
  );
}

const RESPONSE_STATUS_LABEL: Record<CustomerProofPortalGroup["responseStatus"], string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  AWAITING_RESPONSE: "Awaiting your response",
  SUPERSEDED: "No longer actionable",
};

function ProofGroupCard({ token, group }: { token: string; group: CustomerProofPortalGroup }) {
  const [mode, setMode] = useState<"idle" | "approve" | "changes">("idle");

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">{group.name}</h2>
          <p className="text-sm text-muted">
            {DECORATION_METHOD_LABELS[group.decorationMethod]}
            {group.placement ? ` · ${group.placement}` : ""}
          </p>
          {group.products.length > 0 ? (
            <p className="mt-1 text-sm text-muted">
              {group.products
                .map((p) => p.productTitle + (p.variantTitle ? ` (${p.variantTitle})` : ""))
                .join(", ")}
            </p>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            group.responseStatus === "APPROVED"
              ? "bg-success/15 text-success"
              : group.responseStatus === "CHANGES_REQUESTED"
                ? "bg-warning/15 text-warning"
                : group.responseStatus === "SUPERSEDED"
                  ? "bg-muted/15 text-muted"
                  : "bg-accent-blue/25 text-brand-navy"
          }`}
        >
          {RESPONSE_STATUS_LABEL[group.responseStatus]}
        </span>
      </div>

      <p className="mt-3 text-sm font-medium text-ink">Version {group.sentVersion.versionNumber}</p>
      <ProofPreview token={token} version={group.sentVersion} />

      {group.previousVersions.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-brand-navy underline">
            View {group.previousVersions.length} earlier version
            {group.previousVersions.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            {group.previousVersions.map((v) => (
              <div key={v.id}>
                <p className="text-xs text-muted">Version {v.versionNumber}</p>
                <ProofPreview token={token} version={v} />
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {group.responseStatus === "SUPERSEDED" ? (
        <p className="mt-4 text-sm text-muted">
          A newer proof is now available for this item — Just Shear will send you an updated link
          soon.
        </p>
      ) : null}

      {group.responseStatus === "APPROVED" || group.responseStatus === "CHANGES_REQUESTED" ? (
        <div className="mt-4 rounded-md bg-page p-3 text-sm text-ink">
          <p>
            You {group.responseStatus === "APPROVED" ? "approved this proof" : "requested changes"}{" "}
            on{" "}
            {group.response ? new Date(group.response.respondedAt).toLocaleDateString("en-AU") : ""}
            .
          </p>
          {group.response?.customerNote ? (
            <p className="mt-1 text-muted">"{group.response.customerNote}"</p>
          ) : null}
        </div>
      ) : null}

      {group.responseStatus === "AWAITING_RESPONSE" ? (
        <div className="mt-4">
          {mode === "idle" ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setMode("approve");
                }}
                className="min-h-11 flex-1 rounded-md bg-brand-navy px-4 py-3 text-sm font-semibold text-white sm:flex-none"
              >
                Approve Proof
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("changes");
                }}
                className="min-h-11 flex-1 rounded-md border border-border bg-surface px-4 py-3 text-sm font-semibold text-ink sm:flex-none"
              >
                Request Changes
              </button>
            </div>
          ) : mode === "approve" ? (
            <ApproveForm
              token={token}
              group={group}
              onCancel={() => {
                setMode("idle");
              }}
            />
          ) : (
            <ChangesForm
              token={token}
              group={group}
              onCancel={() => {
                setMode("idle");
              }}
            />
          )}
        </div>
      ) : null}
    </section>
  );
}

function ProofPreview({
  token,
  version,
}: {
  token: string;
  version: { id: string; versionNumber: number; assets: { id: string; mimeType: string | null }[] };
}) {
  const primary = version.assets[0];
  if (!primary) {
    return <p className="mt-2 text-sm text-muted">No preview available.</p>;
  }
  const assetUrl = `/proof/${token}/asset/${primary.id}`;
  const isImage = primary.mimeType === "image/png" || primary.mimeType === "image/jpeg";

  if (isImage) {
    return (
      <img
        src={assetUrl}
        alt={`Proof preview, version ${version.versionNumber}`}
        className="mt-2 w-full max-w-full rounded-md border border-border object-contain"
        loading="lazy"
      />
    );
  }
  return (
    <a
      href={assetUrl}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-block text-sm text-brand-navy underline"
    >
      View PDF proof
    </a>
  );
}

function ApproveForm({
  group,
  token,
  onCancel,
}: {
  group: CustomerProofPortalGroup;
  token: string;
  onCancel: () => void;
}) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [acknowledged, setAcknowledged] = useState(false);
  // Generated once — this form is replaced by a success message the moment
  // a submission succeeds, so it never needs to be resubmitted with a fresh key.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  if (fetcher.data?.ok) {
    return <p className="text-sm font-medium text-success">Thanks — this proof is now approved.</p>;
  }

  return (
    <fetcher.Form method="post" action={`/proof/${token}/respond`} className="flex flex-col gap-3">
      <input type="hidden" name="_intent" value="approve" />
      <input type="hidden" name="proofGroupId" value={group.proofGroupId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="acknowledgedApproval" value={acknowledged ? "true" : "false"} />
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => {
            setAcknowledged(e.target.checked);
          }}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span>{PROOF_APPROVAL_ACKNOWLEDGEMENT_TEXT}</span>
      </label>
      {fetcher.data?.error ? (
        <p role="alert" className="text-sm text-error">
          {fetcher.data.error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={!acknowledged || fetcher.state !== "idle"}
          className="min-h-11 flex-1 rounded-md bg-brand-navy px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:flex-none"
        >
          {fetcher.state === "idle" ? "Confirm approval" : "Submitting…"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-md px-4 py-3 text-sm text-muted"
        >
          Cancel
        </button>
      </div>
    </fetcher.Form>
  );
}

function ChangesForm({
  group,
  token,
  onCancel,
}: {
  group: CustomerProofPortalGroup;
  token: string;
  onCancel: () => void;
}) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  // Generated once — this form is replaced by a success message the moment
  // a submission succeeds, so it never needs to be resubmitted with a fresh key.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  if (fetcher.data?.ok) {
    return (
      <p className="text-sm font-medium text-ink">
        Thanks — we've received your feedback and will be in touch with an updated proof.
      </p>
    );
  }

  return (
    <fetcher.Form
      method="post"
      action={`/proof/${token}/respond`}
      encType="multipart/form-data"
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="_intent" value="requestChanges" />
      <input type="hidden" name="proofGroupId" value={group.proofGroupId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <label
        className="flex flex-col gap-1 text-sm text-ink"
        htmlFor={`note-${group.proofGroupId}`}
      >
        What would you like changed?
        <textarea
          id={`note-${group.proofGroupId}`}
          name="customerNote"
          rows={4}
          className="rounded-md border border-border bg-surface p-2 text-sm text-ink"
          placeholder="e.g. Please make the logo slightly larger and change the thread colour to navy."
        />
      </label>
      <label
        className="flex flex-col gap-1 text-sm text-ink"
        htmlFor={`files-${group.proofGroupId}`}
      >
        Attach a marked-up image or file (optional)
        <input
          id={`files-${group.proofGroupId}`}
          type="file"
          name="file"
          multiple
          accept="image/png,image/jpeg,application/pdf"
          className="text-sm"
        />
      </label>
      {fetcher.data?.error ? (
        <p role="alert" className="text-sm text-error">
          {fetcher.data.error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={fetcher.state !== "idle"}
          className="min-h-11 flex-1 rounded-md border border-border bg-surface px-4 py-3 text-sm font-semibold text-ink disabled:opacity-50 sm:flex-none"
        >
          {fetcher.state === "idle" ? "Submit feedback" : "Submitting…"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-md px-4 py-3 text-sm text-muted"
        >
          Cancel
        </button>
      </div>
    </fetcher.Form>
  );
}
