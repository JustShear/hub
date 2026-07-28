import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { Priority } from "@prisma/client";
import { PriorityBadge } from "~/components/board/CardBadges";

export interface PriorityEditorProps {
  currentPriority: Priority;
  canEdit: boolean;
}

type PriorityActionResponse =
  | { intent: "updatePriority"; ok: true }
  | { intent: "updatePriority"; ok: false; error: string }
  | undefined;

const PRIORITY_VALUES: Priority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
const REASON_REQUIRED: Priority[] = ["HIGH", "URGENT"];

// SRS 13.2: HIGH and URGENT require a reason — the reason field only
// appears once one of those is selected, and Save is disabled until it's
// filled in, rather than rejecting silently after submission.
export function PriorityEditor({ currentPriority, canEdit }: PriorityEditorProps) {
  const fetcher = useFetcher<PriorityActionResponse>();

  const [prevPriority, setPrevPriority] = useState(currentPriority);
  const [selected, setSelected] = useState<Priority>(currentPriority);
  const [reason, setReason] = useState("");
  if (currentPriority !== prevPriority) {
    setPrevPriority(currentPriority);
    setSelected(currentPriority);
    setReason("");
  }

  const response = fetcher.data;

  /* eslint-disable react-hooks/set-state-in-effect -- reacting to an async fetch completing
     (an external system), not mirroring a prop into state. */
  useEffect(() => {
    if (fetcher.state === "idle" && response) {
      if (response.ok) {
        setReason("");
      } else {
        setSelected(currentPriority);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react when the fetcher itself settles
  }, [fetcher.state, response]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!canEdit) {
    return (
      <div>
        <h4 className="text-xs font-medium text-muted">Priority</h4>
        <div className="mt-1">
          <PriorityBadge priority={currentPriority} />
        </div>
      </div>
    );
  }

  const reasonRequired = REASON_REQUIRED.includes(selected);
  const isDirty = selected !== currentPriority;
  const canSave =
    isDirty && (!reasonRequired || reason.trim().length > 0) && fetcher.state === "idle";

  return (
    <div>
      <h4 className="text-xs font-medium text-muted">Priority</h4>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select
          value={selected}
          disabled={fetcher.state !== "idle"}
          onChange={(e) => {
            setSelected(e.target.value as Priority);
          }}
          className="rounded border border-border bg-page px-2 py-1.5 text-sm text-ink"
        >
          {PRIORITY_VALUES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        {isDirty ? (
          <button
            type="button"
            disabled={!canSave}
            onClick={() => {
              void fetcher.submit(
                {
                  _intent: "updatePriority",
                  targetPriority: selected,
                  expectedPriority: currentPriority,
                  reason,
                },
                { method: "post" },
              );
            }}
            className="rounded-md bg-brand-navy px-2.5 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Save
          </button>
        ) : null}
      </div>
      {reasonRequired && isDirty ? (
        <label className="mt-2 flex flex-col gap-1 text-xs text-muted">
          Reason (required for {selected})
          <input
            type="text"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            className="rounded border border-border px-2 py-1.5 text-sm"
          />
        </label>
      ) : null}
      {response && !response.ok ? (
        <p role="alert" className="mt-1 text-xs text-error">
          {response.error}
        </p>
      ) : null}
    </div>
  );
}
