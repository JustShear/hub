import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Loader2 } from "lucide-react";
import type { OrderDetailActivityEvent } from "~/domain/orders/order-detail-query.server";
import { EmptyState } from "~/components/shared/EmptyState";
import { formatAuDateTime } from "~/lib/dates";

export interface ActivityTabProps {
  orderId: string;
  initialEvents: OrderDetailActivityEvent[];
  initialHasMore: boolean;
}

function actorLabel(event: OrderDetailActivityEvent): string {
  if (event.actorType === "SYSTEM") return "System";
  if (event.actorType === "CUSTOMER") return "Customer";
  return event.actorStaffName ?? "Unknown staff member";
}

function EventRow({ event }: { event: OrderDetailActivityEvent }) {
  return (
    <div className="flex gap-3 border-b border-border py-2.5 last:border-b-0">
      <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-navy" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{event.summary}</p>
        <p className="mt-0.5 text-xs text-muted">
          {actorLabel(event)} · {formatAuDateTime(event.createdAt)}
        </p>
      </div>
    </div>
  );
}

export function ActivityTab({ orderId, initialEvents, initialHasMore }: ActivityTabProps) {
  const [events, setEvents] = useState(initialEvents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const fetcher = useFetcher<{ events: OrderDetailActivityEvent[]; hasMore: boolean }>();
  const lastProcessed = useRef<typeof fetcher.data>(undefined);

  // Other tabs' edits (assignment, priority, due dates, notes) revalidate
  // this route's loader, which produces a fresh initialEvents array — sync
  // to it so a newly recorded event shows up without a manual refresh.
  const [prevInitialEvents, setPrevInitialEvents] = useState(initialEvents);
  if (initialEvents !== prevInitialEvents) {
    setPrevInitialEvents(initialEvents);
    setEvents(initialEvents);
    setHasMore(initialHasMore);
  }

  function loadMore() {
    const cursor = events[events.length - 1]?.id;
    if (!cursor) return;
    void fetcher.load(`/orders/${orderId}/more?section=activity&cursor=${cursor}`);
  }

  useEffect(() => {
    const data = fetcher.data;
    if (data && data !== lastProcessed.current) {
      lastProcessed.current = data;
      setEvents((current) => [...current, ...data.events]);
      setHasMore(data.hasMore);
    }
  }, [fetcher.data]);

  if (events.length === 0) {
    return (
      <EmptyState
        title="No activity recorded"
        description="Meaningful changes to this order will appear here as they happen."
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {events.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
      {hasMore ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={fetcher.state !== "idle"}
          className="mt-2 flex items-center justify-center gap-2 rounded-md border border-border bg-surface py-2 text-sm text-muted hover:bg-page disabled:opacity-60"
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
