import { Loader2 } from "lucide-react";
import { Link, useLocation } from "react-router";
import type { BoardCard } from "~/domain/orders/board-query.server";
import { PriorityBadge, TagChips } from "~/components/board/CardBadges";
import { CardThumbnails } from "~/components/board/CardThumbnails";
import { EmptyState } from "~/components/shared/EmptyState";
import { formatAuDate } from "~/lib/dates";

export interface SpecialStatusListProps {
  label: string;
  cards: BoardCard[];
  hasMore: boolean;
  loadMorePending: boolean;
  onLoadMore: () => void;
}

// On-hold / cancelled / archived orders never appear on the main workflow
// board (SRS 9.2) — this is a deliberately read-only list, no drag handle
// and no "Move to" menu, since reactivating one of these isn't supported
// from the board yet. Each row still opens the full order drawer.
export function SpecialStatusList({
  label,
  cards,
  hasMore,
  loadMorePending,
  onLoadMore,
}: SpecialStatusListProps) {
  const location = useLocation();

  if (cards.length === 0) {
    return (
      <EmptyState
        title={`No ${label.toLowerCase()} orders`}
        description="Nothing matches your current filters."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {cards.map((card) => (
        <Link
          key={card.id}
          to={{ pathname: `/orders/${card.id}`, search: location.search }}
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-left text-sm shadow-sm hover:border-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold text-ink">{card.orderNumber}</span>
            <PriorityBadge priority={card.priority} />
          </div>
          <p className="text-muted">{card.customerName ?? "No customer name"}</p>
          <p className="text-xs text-muted">
            Ordered {formatAuDate(card.shopifyCreatedAt)} · {card.daysInState} day
            {card.daysInState === 1 ? "" : "s"} in this state
          </p>
          <CardThumbnails lines={card.lines} totalLineCount={card.lineCount} />
          {card.tags.length > 0 ? <TagChips tags={card.tags} /> : null}
        </Link>
      ))}
      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadMorePending}
          className="flex items-center justify-center gap-2 rounded-md border border-border bg-page py-2 text-sm text-muted hover:bg-surface disabled:opacity-60"
        >
          {loadMorePending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
          Load more
        </button>
      ) : null}
    </div>
  );
}
