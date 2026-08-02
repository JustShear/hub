/* eslint-disable react-hooks/refs -- dnd-kit's useDroppable deliberately returns plain state
   (isOver) alongside a ref-setter (setNodeRef) in one object; this isn't the
   ref-read-during-render anti-pattern the rule targets. */
import { useDroppable } from "@dnd-kit/core";
import { Loader2 } from "lucide-react";
import type { BoardCard, BoardColumnResult } from "~/domain/orders/board-query.server";
import type { BoardColumnKey } from "~/domain/orders/board-columns";
import { OrderCard } from "~/components/board/OrderCard";
import { EmptyState } from "~/components/shared/EmptyState";

export interface BoardColumnProps {
  column: BoardColumnResult;
  canManage: boolean;
  canViewIntegrations: boolean;
  canCreateFreightShipments: boolean;
  pendingCardIds: ReadonlySet<string>;
  onMove: (card: BoardCard, targetColumnKey: BoardColumnKey) => void;
  onLoadMore: (columnKey: BoardColumnKey) => void;
  loadMorePending: boolean;
}

export function BoardColumn({
  column,
  canManage,
  canViewIntegrations,
  canCreateFreightShipments,
  pendingCardIds,
  onMove,
  onLoadMore,
  loadMorePending,
}: BoardColumnProps) {
  const droppable = useDroppable({ id: column.key, disabled: !canManage || !column.interactive });

  return (
    <section
      aria-label={`${column.label}, ${column.cards.length} order${column.cards.length === 1 ? "" : "s"}`}
      className={`flex w-72 shrink-0 flex-col rounded-lg border ${
        droppable.isOver ? "border-brand-navy bg-accent-blue/10" : "border-border bg-page"
      }`}
    >
      <header className="flex items-start justify-between gap-2 rounded-t-lg border-b border-border bg-surface px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">{column.label}</h2>
          <p className="text-xs text-muted">{column.purpose}</p>
        </div>
        <span className="shrink-0 rounded-full bg-page px-2 py-0.5 text-xs font-medium text-muted">
          {column.cards.length}
        </span>
      </header>

      <div
        ref={droppable.setNodeRef}
        className="flex max-h-[70vh] flex-1 flex-col gap-2 overflow-y-auto p-2"
      >
        {column.cards.length === 0 ? (
          <EmptyState
            title="No orders here"
            description={
              column.interactive
                ? "Nothing currently matches your filters, or drag a card here."
                : "No orders in this state right now."
            }
          />
        ) : (
          column.cards.map((card) => (
            <OrderCard
              key={card.id}
              card={card}
              canManage={canManage}
              canViewIntegrations={canViewIntegrations}
              canCreateFreightShipments={canCreateFreightShipments}
              isPending={pendingCardIds.has(card.id)}
              onMove={(targetColumnKey) => {
                onMove(card, targetColumnKey);
              }}
            />
          ))
        )}

        {column.hasMore ? (
          <button
            type="button"
            onClick={() => {
              onLoadMore(column.key);
            }}
            disabled={loadMorePending}
            className="flex items-center justify-center gap-2 rounded-md border border-border bg-surface py-2 text-sm text-muted hover:bg-page disabled:opacity-60"
          >
            {loadMorePending ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : null}
            Load more
          </button>
        ) : null}
      </div>

      {!column.interactive ? (
        <p className="border-t border-border px-3 py-1.5 text-xs text-muted">
          {column.readOnlyReason}
        </p>
      ) : null}
    </section>
  );
}
