import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

export interface AssignmentEditorProps {
  currentStaffUserId: string | null;
  currentStaffUserName: string | null;
  assignableStaff: { id: string; name: string }[];
  canEdit: boolean;
}

type AssignmentActionResponse =
  | { intent: "updateAssignment"; ok: true }
  | { intent: "updateAssignment"; ok: false; error: string }
  | undefined;

// Compare-and-swap against the server (update-assignment.server.ts) — the
// hidden expectedStaffUserId field is what makes a stale edit detectable.
export function AssignmentEditor({
  currentStaffUserId,
  currentStaffUserName,
  assignableStaff,
  canEdit,
}: AssignmentEditorProps) {
  const fetcher = useFetcher<AssignmentActionResponse>();

  const [prevStaffId, setPrevStaffId] = useState(currentStaffUserId);
  const [selected, setSelected] = useState(currentStaffUserId ?? "");
  if (currentStaffUserId !== prevStaffId) {
    setPrevStaffId(currentStaffUserId);
    setSelected(currentStaffUserId ?? "");
  }

  const response = fetcher.data;

  /* eslint-disable react-hooks/set-state-in-effect -- reacting to an async fetch completing
     (an external system), not mirroring a prop into state. */
  useEffect(() => {
    if (fetcher.state === "idle" && response && !response.ok) {
      setSelected(currentStaffUserId ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react when the fetcher itself settles
  }, [fetcher.state, response]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!canEdit) {
    return (
      <div>
        <h4 className="text-xs font-medium text-muted">Assigned to</h4>
        <p className="mt-1 text-sm text-ink">{currentStaffUserName ?? "Unassigned"}</p>
      </div>
    );
  }

  return (
    <div>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Assigned to
        <select
          value={selected}
          disabled={fetcher.state !== "idle"}
          onChange={(e) => {
            const value = e.target.value;
            setSelected(value);
            void fetcher.submit(
              {
                _intent: "updateAssignment",
                targetStaffUserId: value,
                expectedStaffUserId: currentStaffUserId ?? "",
              },
              { method: "post" },
            );
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
