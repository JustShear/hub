import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { OrderDetail } from "~/domain/orders/order-detail-query.server";
import { DECORATION_METHOD_LABELS } from "~/domain/proofs/labels";

export interface SendProofDialogProps {
  order: OrderDetail;
}

type SendProofResponse =
  | { intent: "sendProofRequest"; ok: true; proofRequestId: string }
  | { intent: "sendProofRequest"; ok: false; error: string; issues?: string[] };

// Only groups the customer-sending workflow can actually act on are ever
// selectable — everything else is shown, greyed out, with the reason it
// isn't eligible right now, so staff never wonder why a group is missing.
export function SendProofDialog({ order }: SendProofDialogProps) {
  const fetcher = useFetcher<SendProofResponse>();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const response = fetcher.data;
  const eligibleGroups = order.proofGroups.filter((g) => g.status === "READY_TO_SEND");
  const ineligibleGroups = order.proofGroups.filter(
    (g) =>
      g.status !== "READY_TO_SEND" && g.status !== "CANCELLED" && g.status !== "NO_PROOF_REQUIRED",
  );
  const hasCustomerEmail = Boolean(order.customerEmail?.trim());

  /* eslint-disable react-hooks/set-state-in-effect -- reacting to an async fetch completing
     (an external system), not mirroring a prop into state. */
  useEffect(() => {
    if (fetcher.state === "idle" && response?.ok) {
      setOpen(false);
      setSelected(new Set());
    }
  }, [fetcher.state, response]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggle(groupId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          disabled={eligibleGroups.length === 0}
          className="rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white hover:bg-brand-navy/90 disabled:opacity-50"
        >
          Send proof to customer
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-ink/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-[61] max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-lg focus:outline-none">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold text-ink">
              Send proof to customer
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded-md p-1 text-muted hover:bg-page hover:text-ink"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {!hasCustomerEmail ? (
            <p className="mt-3 text-sm text-error">
              This order has no customer email on file — a proof can't be sent until one is
              available.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted">
              Sending to: {order.customerEmail}
              {order.customerName ? ` (${order.customerName})` : ""}
            </p>
          )}

          <fetcher.Form
            method="post"
            action={`/orders/${order.id}/proof-groups`}
            className="mt-3 flex flex-col gap-3"
          >
            <input type="hidden" name="_intent" value="sendProofRequest" />

            <fieldset className="rounded border border-border p-2">
              <legend className="px-1 text-xs font-medium text-muted">
                Ready to send ({eligibleGroups.length})
              </legend>
              {eligibleGroups.length === 0 ? (
                <p className="p-2 text-sm text-muted">
                  No proof groups are currently ready to send — mark a version ready to send first.
                </p>
              ) : (
                <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {eligibleGroups.map((group) => (
                    <label key={group.id} className="flex items-start gap-2 p-1 text-sm text-ink">
                      <input
                        type="checkbox"
                        name="proofGroupId"
                        value={group.id}
                        checked={selected.has(group.id)}
                        onChange={() => {
                          toggle(group.id);
                        }}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium">{group.name}</span>
                        <span className="text-muted">
                          {" "}
                          — {DECORATION_METHOD_LABELS[group.decorationMethod]}
                          {group.placement ? `, ${group.placement}` : ""} · v
                          {group.versions[0]?.versionNumber ?? "?"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            {ineligibleGroups.length > 0 ? (
              <details className="rounded border border-border p-2 text-xs text-muted">
                <summary className="cursor-pointer font-medium">
                  {ineligibleGroups.length} group{ineligibleGroups.length === 1 ? "" : "s"} not
                  ready to send
                </summary>
                <ul className="mt-1 list-disc pl-4">
                  {ineligibleGroups.map((group) => (
                    <li key={group.id}>
                      {group.name}: {group.readiness.issues[0] ?? "not marked ready to send"}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Optional message to the customer
              <textarea
                name="staffMessage"
                rows={2}
                className="rounded border border-border px-2 py-1.5 text-sm text-ink"
                placeholder="e.g. Here's the proof for your recent order — please take a look when you get a chance."
              />
            </label>

            {response && !response.ok ? (
              <div role="alert" className="text-xs text-error">
                <p>{response.error}</p>
                {response.issues && response.issues.length > 0 ? (
                  <ul className="mt-1 list-disc pl-4">
                    {response.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="mt-2 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className="rounded-md px-3 py-1.5 text-sm text-muted">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={selected.size === 0 || !hasCustomerEmail || fetcher.state !== "idle"}
                className="rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Send {selected.size > 0 ? `(${selected.size})` : ""}
              </button>
            </div>
          </fetcher.Form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
