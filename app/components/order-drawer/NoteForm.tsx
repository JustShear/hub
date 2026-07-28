import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

const MAX_NOTE_LENGTH = 5000;

type AddNoteActionResponse =
  { intent: "addNote"; ok: true } | { intent: "addNote"; ok: false; error: string } | undefined;

export function NoteForm() {
  const fetcher = useFetcher<AddNoteActionResponse>();
  const [body, setBody] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const response = fetcher.data;
  const wasSubmitting = useRef(false);

  useEffect(() => {
    if (fetcher.state === "idle" && wasSubmitting.current && response?.ok) {
      setBody("");
    }
    wasSubmitting.current = fetcher.state !== "idle";
  }, [fetcher.state, response]);

  const trimmedLength = body.trim().length;
  const canSubmit = trimmedLength > 0 && body.length <= MAX_NOTE_LENGTH && fetcher.state === "idle";

  return (
    <fetcher.Form
      ref={formRef}
      method="post"
      onSubmit={(event) => {
        if (!canSubmit) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="_intent" value="addNote" />
      <textarea
        name="body"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
        }}
        maxLength={MAX_NOTE_LENGTH}
        rows={3}
        placeholder="Add an internal note — not visible to the customer."
        className="rounded border border-border bg-page px-2 py-1.5 text-sm text-ink"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          {body.length} / {MAX_NOTE_LENGTH}
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Add note
        </button>
      </div>
      {response && !response.ok ? (
        <p role="alert" className="text-xs text-error">
          {response.error}
        </p>
      ) : null}
    </fetcher.Form>
  );
}
