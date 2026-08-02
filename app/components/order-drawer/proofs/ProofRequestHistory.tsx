import { useState } from "react";
import { useFetcher } from "react-router";
import type { OrderDetailProofRequest } from "~/domain/proofs/proof-request-query.server";
import { formatAuDateTime } from "~/lib/dates";

export interface ProofRequestHistoryProps {
  orderId: string;
  requests: OrderDetailProofRequest[];
  canResend: boolean;
  canRevoke: boolean;
  canManageReminders: boolean;
}

const RESPONSE_TYPE_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
};

export function ProofRequestHistory({
  orderId,
  requests,
  canResend,
  canRevoke,
  canManageReminders,
}: ProofRequestHistoryProps) {
  if (requests.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">Proof requests sent to customer</h3>
      {requests.map((request) => (
        <ProofRequestCard
          key={request.id}
          orderId={orderId}
          request={request}
          canResend={canResend}
          canRevoke={canRevoke}
          canManageReminders={canManageReminders}
        />
      ))}
    </section>
  );
}

function ProofRequestCard({
  orderId,
  request,
  canResend,
  canRevoke,
  canManageReminders,
}: {
  orderId: string;
  request: OrderDetailProofRequest;
  canResend: boolean;
  canRevoke: boolean;
  canManageReminders: boolean;
}) {
  const actionFetcher = useFetcher();
  const [revokeReason, setRevokeReason] = useState("");
  const [showRevoke, setShowRevoke] = useState(false);

  const latestDelivery = request.deliveries[0] ?? null;
  const isActive = !request.revokedAt && request.status !== "COMPLETED" && !request.isExpired;

  function submit(formData: FormData) {
    void actionFetcher.submit(formData, {
      method: "post",
      action: `/orders/${orderId}/proof-groups`,
    });
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">
            Sent {request.sentAt ? formatAuDateTime(request.sentAt) : "—"} to{" "}
            {request.customerEmail}
          </p>
          <p className="text-xs text-muted">By {request.createdByStaffName}</p>
        </div>
        <StatusBadge request={request} />
      </div>

      {request.staffMessage ? (
        <p className="mt-2 rounded bg-page p-2 text-xs text-ink">"{request.staffMessage}"</p>
      ) : null}

      <div className="mt-2 flex flex-col gap-1.5">
        {request.groups.map((group) => (
          <div key={group.proofGroupId} className="rounded border border-border p-2 text-xs">
            <p className="font-medium text-ink">
              {group.proofGroupName} (version {group.versionNumber})
            </p>
            {group.response ? (
              <div className="mt-1 text-muted">
                <p>
                  {RESPONSE_TYPE_LABEL[group.response.responseType] ?? group.response.responseType}{" "}
                  — {formatAuDateTime(group.response.respondedAt)}
                </p>
                {group.response.customerNote ? (
                  <p className="mt-0.5">"{group.response.customerNote}"</p>
                ) : null}
                {group.response.assets.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {group.response.assets.map((asset) => (
                      <li key={asset.id}>
                        <a
                          href={`/customer-response-assets/${asset.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-navy underline"
                        >
                          Customer mark-up: {asset.originalFilename ?? "file"}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="mt-1 text-muted">
                {group.currentVersionStatus === "SENT" || group.currentVersionStatus === "VIEWED"
                  ? "Awaiting customer response"
                  : "No longer actionable — a newer version may exist"}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>Viewed: {request.viewCount > 0 ? `${request.viewCount} time(s)` : "not yet"}</span>
        <span>
          Delivery:{" "}
          {latestDelivery
            ? `${latestDelivery.status.toLowerCase()}${latestDelivery.status === "FAILED" ? " — retry below" : ""}`
            : "unknown"}
        </span>
        {request.reminder ? (
          <span>
            Reminder:{" "}
            {request.reminder.suppressed
              ? "suppressed"
              : request.reminder.sentAt
                ? "sent"
                : `scheduled for ${formatAuDateTime(request.reminder.scheduledFor)}`}
          </span>
        ) : null}
        {request.revokedAt ? (
          <span className="text-error">Revoked: {request.revokedReason}</span>
        ) : null}
        {request.isExpired && !request.revokedAt ? <span>Expired</span> : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {request.reviewUrl ? (
          <a
            href={request.reviewUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-border px-2 py-1 text-xs text-brand-navy hover:bg-page"
          >
            View approval page
          </a>
        ) : null}
        {canResend && isActive ? (
          <button
            type="button"
            onClick={() => {
              const fd = new FormData();
              fd.set("_intent", "resendProofRequest");
              fd.set("proofRequestId", request.id);
              submit(fd);
            }}
            className="rounded border border-border px-2 py-1 text-xs text-ink hover:bg-page"
          >
            Resend
          </button>
        ) : null}
        {canResend && latestDelivery?.status === "FAILED" ? (
          <button
            type="button"
            onClick={() => {
              const fd = new FormData();
              fd.set("_intent", "retryProofDelivery");
              fd.set("klaviyoDispatchId", latestDelivery.id);
              submit(fd);
            }}
            className="rounded border border-border px-2 py-1 text-xs text-ink hover:bg-page"
          >
            Retry delivery
          </button>
        ) : null}
        {canManageReminders &&
        request.reminder &&
        !request.reminder.sentAt &&
        !request.reminder.suppressed ? (
          <button
            type="button"
            onClick={() => {
              const fd = new FormData();
              fd.set("_intent", "suppressProofReminder");
              fd.set("proofRequestId", request.id);
              fd.set("reason", "Suppressed by staff from the order drawer");
              submit(fd);
            }}
            className="rounded border border-border px-2 py-1 text-xs text-ink hover:bg-page"
          >
            Suppress reminder
          </button>
        ) : null}
        {canRevoke && !request.revokedAt ? (
          <button
            type="button"
            onClick={() => {
              setShowRevoke((v) => !v);
            }}
            className="rounded border border-border px-2 py-1 text-xs text-error hover:bg-page"
          >
            Revoke
          </button>
        ) : null}
      </div>

      {showRevoke ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <input
            value={revokeReason}
            onChange={(e) => {
              setRevokeReason(e.target.value);
            }}
            placeholder="Reason for revoking"
            className="rounded border border-border px-2 py-1 text-xs text-ink"
          />
          <button
            type="button"
            disabled={!revokeReason.trim()}
            onClick={() => {
              const fd = new FormData();
              fd.set("_intent", "revokeProofRequest");
              fd.set("proofRequestId", request.id);
              fd.set("reason", revokeReason);
              submit(fd);
              setShowRevoke(false);
              setRevokeReason("");
            }}
            className="self-start rounded bg-error px-2 py-1 text-xs text-white disabled:opacity-50"
          >
            Confirm revoke
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ request }: { request: OrderDetailProofRequest }) {
  const label = request.revokedAt
    ? "Revoked"
    : request.isExpired
      ? "Expired"
      : request.status === "COMPLETED"
        ? "Completed"
        : request.status === "PARTIALLY_RESPONDED"
          ? "Partially responded"
          : request.status === "VIEWED"
            ? "Viewed"
            : "Sent";
  const colour = request.revokedAt
    ? "bg-error/15 text-error"
    : request.status === "COMPLETED"
      ? "bg-success/15 text-success"
      : "bg-accent-blue/25 text-brand-navy";
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${colour}`}>
      {label}
    </span>
  );
}
