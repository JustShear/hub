import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Loader2 } from "lucide-react";
import type { OrderDetailNote } from "~/domain/orders/order-detail-query.server";
import { EmptyState } from "~/components/shared/EmptyState";
import { NoteForm } from "~/components/order-drawer/NoteForm";
import { formatAuDate } from "~/lib/dates";

export interface NotesTabProps {
  orderId: string;
  initialNotes: OrderDetailNote[];
  initialHasMore: boolean;
  canCreateNotes: boolean;
}

function NoteRow({ note }: { note: OrderDetailNote }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="whitespace-pre-wrap text-sm text-ink">{note.body}</p>
      <p className="mt-1 text-xs text-muted">
        {note.authorStaffName} · {formatAuDate(note.createdAt)} · Internal only
      </p>
    </div>
  );
}

export function NotesTab({ orderId, initialNotes, initialHasMore, canCreateNotes }: NotesTabProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const fetcher = useFetcher<{ notes: OrderDetailNote[]; hasMore: boolean }>();
  const lastProcessed = useRef<typeof fetcher.data>(undefined);

  // NoteForm submits through its own fetcher, which triggers the route's
  // default revalidation — the loader reruns and this component receives a
  // fresh initialNotes array. Sync to it so a newly created note appears
  // immediately, without discarding accumulated "load more" pages the
  // moment they're no longer the freshest first page.
  const [prevInitialNotes, setPrevInitialNotes] = useState(initialNotes);
  if (initialNotes !== prevInitialNotes) {
    setPrevInitialNotes(initialNotes);
    setNotes(initialNotes);
    setHasMore(initialHasMore);
  }

  function loadMore() {
    const cursor = notes[notes.length - 1]?.id;
    if (!cursor) return;
    void fetcher.load(`/orders/${orderId}/more?section=notes&cursor=${cursor}`);
  }

  useEffect(() => {
    const data = fetcher.data;
    if (data && data !== lastProcessed.current) {
      lastProcessed.current = data;
      setNotes((current) => [...current, ...data.notes]);
      setHasMore(data.hasMore);
    }
  }, [fetcher.data]);

  return (
    <div className="flex flex-col gap-4">
      {canCreateNotes ? <NoteForm /> : null}
      {notes.length === 0 ? (
        <EmptyState
          title="No internal notes yet"
          description="Notes added here are internal only and never visible to the customer."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </div>
      )}
      {hasMore ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={fetcher.state !== "idle"}
          className="flex items-center justify-center gap-2 rounded-md border border-border bg-surface py-2 text-sm text-muted hover:bg-page disabled:opacity-60"
        >
          {fetcher.state !== "idle" ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : null}
          Load more
        </button>
      ) : null}
    </div>
  );
}
