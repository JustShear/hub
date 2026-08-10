import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { DecorationMethod, NoProofReason, ProofRequirementValue } from "@prisma/client";
import {
  DECORATION_METHOD_LABELS,
  NO_PROOF_REASON_LABELS,
  PROOF_REQUIREMENT_VALUE_LABELS,
} from "~/domain/proofs/labels";

export interface CreateProofGroupLineOption {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
}

export interface CreateProofGroupAssetOption {
  id: string;
  label: string;
}

export interface CreateProofGroupDialogProps {
  orderId: string;
  lineOptions: CreateProofGroupLineOption[];
  assetOptions: CreateProofGroupAssetOption[];
  assignableStaff: { id: string; name: string }[];
}

const DECORATION_METHODS: DecorationMethod[] = [
  "EMBROIDERY",
  "DIGITAL_PRINT_DTF",
  "SCREEN_PRINT",
  "UNPRINTED",
  "OTHER",
];
const REQUIREMENT_VALUES: ProofRequirementValue[] = ["UNDETERMINED", "REQUIRED", "NOT_REQUIRED"];
const NO_PROOF_REASONS: NoProofReason[] = [
  "UNPRINTED_PRODUCT",
  "REPEAT_JOB_PREVIOUS_ARTWORK",
  "APPROVED_STANDARD_LOGO",
  "CUSTOMER_SUPPLIED_PRODUCTION_READY",
  "INTERNAL_STAFF_ORDER",
  "OTHER",
];

type CreateProofGroupResponse =
  | { intent: "createProofGroup"; ok: true }
  | { intent: "createProofGroup"; ok: false; error: string };

// Defaults to REQUIRED so staff don't have to think about it for the common
// case — but it's still just a pre-selected option, never enforced or
// inferred from whether lines/assets were selected; staff can change it to
// anything before submitting.
export function CreateProofGroupDialog({
  orderId,
  lineOptions,
  assetOptions,
  assignableStaff,
}: CreateProofGroupDialogProps) {
  const fetcher = useFetcher<CreateProofGroupResponse>();
  const [open, setOpen] = useState(false);
  const [requirement, setRequirement] = useState<ProofRequirementValue>("REQUIRED");
  const [noProofReason, setNoProofReason] = useState<NoProofReason | "">("");
  const [decorationMethod, setDecorationMethod] = useState<DecorationMethod>("EMBROIDERY");
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());

  const allLinesSelected =
    lineOptions.length > 0 && lineOptions.every((line) => selectedLineIds.has(line.id));

  function toggleLine(lineId: string) {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) {
        next.delete(lineId);
      } else {
        next.add(lineId);
      }
      return next;
    });
  }

  function toggleAllLines() {
    setSelectedLineIds(allLinesSelected ? new Set() : new Set(lineOptions.map((line) => line.id)));
  }

  const response = fetcher.data;

  /* eslint-disable react-hooks/set-state-in-effect -- reacting to an async fetch completing
     (an external system), not mirroring a prop into state. */
  useEffect(() => {
    if (fetcher.state === "idle" && response?.ok) {
      setOpen(false);
      setRequirement("REQUIRED");
      setNoProofReason("");
      setDecorationMethod("EMBROIDERY");
      setSelectedLineIds(new Set());
    }
  }, [fetcher.state, response]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white hover:bg-brand-navy/90"
        >
          Create proof group
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-ink/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-lg focus:outline-none">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold text-ink">
              Create proof group
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

          <fetcher.Form
            method="post"
            action={`/orders/${orderId}/proof-groups`}
            className="mt-3 flex flex-col gap-3"
          >
            <input type="hidden" name="_intent" value="createProofGroup" />

            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Group name (optional)
              <input
                name="name"
                placeholder="e.g. Left chest embroidery — leave blank to auto-name"
                className="rounded border border-border px-2 py-1.5 text-sm text-ink"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Description
              <textarea
                name="description"
                rows={2}
                className="rounded border border-border px-2 py-1.5 text-sm text-ink"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Decoration method
                <select
                  name="decorationMethod"
                  value={decorationMethod}
                  onChange={(e) => {
                    setDecorationMethod(e.target.value as DecorationMethod);
                  }}
                  className="rounded border border-border bg-page px-2 py-1.5 text-sm text-ink"
                >
                  {DECORATION_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {DECORATION_METHOD_LABELS[method]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Placement{decorationMethod === "UNPRINTED" ? " (optional)" : ""}
                <input
                  name="placement"
                  className="rounded border border-border px-2 py-1.5 text-sm text-ink"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Proof requirement (optional — can be decided later)
              <select
                name="requirement"
                value={requirement}
                onChange={(e) => {
                  setRequirement(e.target.value as ProofRequirementValue);
                }}
                className="rounded border border-border bg-page px-2 py-1.5 text-sm text-ink"
              >
                {REQUIREMENT_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {PROOF_REQUIREMENT_VALUE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>

            {requirement === "NOT_REQUIRED" ? (
              <>
                <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                  Reason
                  <select
                    name="noProofReason"
                    required
                    value={noProofReason}
                    onChange={(e) => {
                      setNoProofReason(e.target.value as NoProofReason);
                    }}
                    className="rounded border border-border bg-page px-2 py-1.5 text-sm text-ink"
                  >
                    <option value="" disabled>
                      Choose a reason…
                    </option>
                    {NO_PROOF_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {NO_PROOF_REASON_LABELS[reason]}
                      </option>
                    ))}
                  </select>
                </label>
                {noProofReason === "OTHER" ? (
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                    Explain why
                    <textarea
                      name="noProofReasonNote"
                      required
                      rows={2}
                      className="rounded border border-border px-2 py-1.5 text-sm text-ink"
                    />
                  </label>
                ) : null}
              </>
            ) : null}

            {lineOptions.length > 0 ? (
              <fieldset className="rounded border border-border p-2">
                <div className="flex items-center justify-between px-1">
                  <legend className="text-xs font-medium text-muted">Linked order lines</legend>
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input type="checkbox" checked={allLinesSelected} onChange={toggleAllLines} />
                    Select all
                  </label>
                </div>
                <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                  {lineOptions.map((line) => (
                    <label key={line.id} className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        name="orderLineId"
                        value={line.id}
                        checked={selectedLineIds.has(line.id)}
                        onChange={() => {
                          toggleLine(line.id);
                        }}
                      />
                      {line.productTitle}
                      {line.variantTitle ? ` — ${line.variantTitle}` : ""} (qty {line.quantity})
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {assetOptions.length > 0 ? (
              <fieldset className="rounded border border-border p-2">
                <legend className="px-1 text-xs font-medium text-muted">
                  Linked customer uploads
                </legend>
                <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                  {assetOptions.map((asset) => (
                    <label key={asset.id} className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" name="assetId" value={asset.id} />
                      {asset.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Assigned artwork staff
                <select
                  name="assignedStaffId"
                  defaultValue=""
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
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Priority
                <select
                  name="priority"
                  defaultValue="NORMAL"
                  className="rounded border border-border bg-page px-2 py-1.5 text-sm text-ink"
                >
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Internal due date
              <input
                type="date"
                name="dueDate"
                className="rounded border border-border px-2 py-1.5 text-sm text-ink"
              />
            </label>

            {response && !response.ok ? (
              <p role="alert" className="text-xs text-error">
                {response.error}
              </p>
            ) : null}

            <div className="mt-2 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className="rounded-md px-3 py-1.5 text-sm text-muted">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={fetcher.state !== "idle"}
                className="rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </fetcher.Form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
