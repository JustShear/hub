import { useEffect, useMemo, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useFetcher, useSearchParams } from "react-router";
import type { OrderStatus } from "@prisma/client";
import { PageHeader } from "~/components/shared/PageHeader";
import { EmptyState } from "~/components/shared/EmptyState";
import { ErrorAlert } from "~/components/shared/ErrorAlert";
import { BoardColumn } from "~/components/board/BoardColumn";
import { BoardFiltersBar } from "~/components/board/BoardFiltersBar";
import { BoardSearchInput } from "~/components/board/BoardSearchInput";
import { SavedViewsMenu } from "~/components/board/SavedViewsMenu";
import { SpecialStatusList } from "~/components/board/SpecialStatusList";
import {
  boardFiltersToSearchParams,
  SORT_FIELDS,
  SORT_FIELD_LABELS,
  usesCursorPagination,
  type BoardFilters,
  type BoardSort,
  type BoardView,
  type SortField,
} from "~/domain/orders/board-filters";
import { getBoardColumn, type BoardColumnKey } from "~/domain/orders/board-columns";
import { canMoveOrderToColumn } from "~/domain/orders/workflow-transitions";
import type {
  BoardCard,
  BoardColumnResult,
  BoardFilterOptions,
  LoadBoardResult,
} from "~/domain/orders/board-query.server";
import type { SavedViewSummary } from "~/domain/orders/saved-views.server";

export interface BoardPageProps {
  view: BoardView;
  filters: BoardFilters;
  sort: BoardSort;
  canManage: boolean;
  canViewIntegrations: boolean;
  board: LoadBoardResult | null;
  special: { cards: BoardCard[]; nextCursorId: string | null } | null;
  filterOptions: BoardFilterOptions;
  savedViews: SavedViewSummary[];
  currentStaffUserId: string;
}

type MoveActionResponse =
  | { intent: "move"; ok: true; workflowStatus: OrderStatus }
  | { intent: "move"; ok: false; error: string };

const VIEW_TABS: { key: BoardView; label: string }[] = [
  { key: "board", label: "Board" },
  { key: "on_hold", label: "On Hold" },
  { key: "cancelled", label: "Cancelled" },
  { key: "archived", label: "Archived" },
];

export function BoardPage(props: BoardPageProps) {
  const {
    view,
    filters,
    sort,
    canManage,
    canViewIntegrations,
    board,
    special,
    filterOptions,
    savedViews,
  } = props;

  const [searchParams, setSearchParams] = useSearchParams();
  const moveFetcher = useFetcher<MoveActionResponse>();
  const loadMoreFetcher = useFetcher<{
    cards: BoardCard[];
    nextCursorId: string | null;
    nextOffset: number | null;
  }>();

  // Optimistic local copies of the server data — reset via the "adjust
  // state during render" pattern (React's documented approach for syncing
  // state to a changed prop) rather than an effect, so a filter/sort/view
  // navigation or a post-move revalidation never shows a stale frame first.
  const [prevBoard, setPrevBoard] = useState(board);
  const [columns, setColumns] = useState<BoardColumnResult[]>(board?.columns ?? []);
  if (board !== prevBoard) {
    setPrevBoard(board);
    setColumns(board?.columns ?? []);
  }

  const [prevSpecial, setPrevSpecial] = useState(special);
  const [specialCards, setSpecialCards] = useState<BoardCard[]>(special?.cards ?? []);
  const [specialCursor, setSpecialCursor] = useState<string | null>(special?.nextCursorId ?? null);
  if (special !== prevSpecial) {
    setPrevSpecial(special);
    setSpecialCards(special?.cards ?? []);
    setSpecialCursor(special?.nextCursorId ?? null);
  }

  const [pendingCardIds, setPendingCardIds] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const [loadingMoreColumn, setLoadingMoreColumn] = useState<BoardColumnKey | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function moveCard(card: BoardCard, toKey: BoardColumnKey) {
    const check = canMoveOrderToColumn(card.workflowStatus, toKey);
    if (!check.allowed) {
      setAnnouncement(`Can't move ${card.orderNumber}: ${check.reason ?? "not allowed"}`);
      return;
    }
    const targetColumn = getBoardColumn(toKey);
    const targetStatus = targetColumn.dropSetsWorkflowStatus;
    if (!targetStatus || card.columnKey === toKey) return;

    const fromKey = card.columnKey;
    setColumns((prev) =>
      prev.map((col) => {
        if (col.key === fromKey)
          return { ...col, cards: col.cards.filter((c) => c.id !== card.id) };
        if (col.key === toKey) {
          return {
            ...col,
            cards: [{ ...card, workflowStatus: targetStatus, columnKey: toKey }, ...col.cards],
          };
        }
        return col;
      }),
    );
    setPendingCardIds((prev) => new Set(prev).add(card.id));

    void moveFetcher.submit(
      {
        _intent: "move",
        orderId: card.id,
        targetColumnKey: toKey,
        expectedWorkflowStatus: card.workflowStatus,
      },
      { method: "post" },
    );
  }

  // Reacting to a fetcher's async completion (an external system, per React's
  // own effect guidance) — not a prop-mirroring pattern, so this genuinely
  // belongs in an effect rather than during render.
  /* eslint-disable react-hooks/set-state-in-effect -- reacting to an async fetch completing
     (an external system), not mirroring a prop into state. */
  useEffect(() => {
    if (moveFetcher.state !== "idle" || !moveFetcher.data) return;
    const data = moveFetcher.data;
    setPendingCardIds(new Set());
    if (data.ok) {
      setAnnouncement("Order moved.");
    } else {
      setAnnouncement(`Move failed: ${data.error}`);
      setColumns(board?.columns ?? []);
    }
    // Only react when the fetcher itself settles, not when `board` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveFetcher.state, moveFetcher.data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleDragEnd(event: DragEndEvent) {
    const cardData = event.active.data.current as { card: BoardCard } | undefined;
    const targetKey = event.over?.id as BoardColumnKey | undefined;
    if (!cardData || !targetKey) return;
    moveCard(cardData.card, targetKey);
  }

  function loadMoreForColumn(columnKey: BoardColumnKey) {
    const column = columns.find((c) => c.key === columnKey);
    if (!column) return;
    const params = new URLSearchParams(searchParams);
    params.set("columnKey", columnKey);
    params.delete("cursor");
    params.delete("offset");
    if (usesCursorPagination(sort.field)) {
      const last = column.cards.at(-1);
      if (last) params.set("cursor", last.id);
    } else {
      params.set("offset", String(column.cards.length));
    }
    setLoadingMoreColumn(columnKey);
    void loadMoreFetcher.load(`/orders/column?${params.toString()}`);
  }

  /* eslint-disable react-hooks/set-state-in-effect -- reacting to an async fetch completing
     (an external system), not mirroring a prop into state. */
  useEffect(() => {
    if (loadMoreFetcher.state !== "idle" || !loadMoreFetcher.data || !loadingMoreColumn) return;
    const { cards: newCards, nextCursorId, nextOffset } = loadMoreFetcher.data;
    const key = loadingMoreColumn;
    setColumns((prev) =>
      prev.map((col) =>
        col.key === key
          ? {
              ...col,
              cards: [...col.cards, ...newCards],
              hasMore: nextCursorId !== null || nextOffset !== null,
            }
          : col,
      ),
    );
    setLoadingMoreColumn(null);
    // Only react when the fetcher itself settles, not when `loadingMoreColumn` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMoreFetcher.state, loadMoreFetcher.data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function loadMoreSpecial() {
    if (!specialCursor) return;
    const params = new URLSearchParams(searchParams);
    params.set("view", view);
    params.set("cursor", specialCursor);
    // Special views reuse the same board loader (via navigation), so "load
    // more" here just re-requests with a larger implicit page — kept simple
    // since these lists are inherently smaller/less time-sensitive.
    setSearchParams(params, { replace: true });
  }

  function handleSortChange(field: SortField) {
    setSearchParams(boardFiltersToSearchParams(filters, { field }, view), { replace: true });
  }

  function handleViewChange(nextView: BoardView) {
    setSearchParams(boardFiltersToSearchParams(filters, sort, nextView));
  }

  const totalOrders = useMemo(
    () => columns.reduce((sum, col) => sum + col.cards.length, 0),
    [columns],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Orders"
        description="The Stage One Kanban board — proofing workflow only."
      />

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-current={view === tab.key ? "page" : undefined}
            onClick={() => {
              handleViewChange(tab.key);
            }}
            className={`rounded-t-md border-b-2 px-3 py-1.5 text-sm font-medium ${
              view === tab.key
                ? "border-brand-navy text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <BoardSearchInput filters={filters} sort={sort} view={view} />
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-page px-3 text-sm text-ink">
          Sort
          <select
            value={sort.field}
            onChange={(e) => {
              handleSortChange(e.target.value as SortField);
            }}
            className="bg-transparent focus:outline-none"
          >
            {SORT_FIELDS.map((field) => (
              <option key={field} value={field}>
                {SORT_FIELD_LABELS[field]}
              </option>
            ))}
          </select>
        </label>
        <SavedViewsMenu
          savedViews={savedViews}
          currentFilters={filters}
          currentSort={sort}
          currentView={view}
        />
        {!canManage ? (
          <span className="text-xs text-muted">
            View-only — you don't have permission to move orders.
          </span>
        ) : null}
      </div>

      {view === "board" ? (
        <BoardFiltersBar filters={filters} sort={sort} view={view} filterOptions={filterOptions} />
      ) : null}

      {view === "board" ? (
        totalOrders === 0 && columns.every((c) => c.cards.length === 0) ? (
          <EmptyState
            title="No orders match your filters"
            description="Try resetting filters, or check back once orders have been imported."
          />
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="flex gap-3 overflow-x-auto pb-4">
              {columns.map((column) => (
                <BoardColumn
                  key={column.key}
                  column={column}
                  canManage={canManage}
                  canViewIntegrations={canViewIntegrations}
                  pendingCardIds={pendingCardIds}
                  onMove={moveCard}
                  onLoadMore={loadMoreForColumn}
                  loadMorePending={loadingMoreColumn === column.key}
                />
              ))}
            </div>
          </DndContext>
        )
      ) : (
        <SpecialStatusList
          label={VIEW_TABS.find((t) => t.key === view)?.label ?? view}
          cards={specialCards}
          hasMore={specialCursor !== null}
          loadMorePending={false}
          onLoadMore={loadMoreSpecial}
        />
      )}

      {moveFetcher.data && !moveFetcher.data.ok ? (
        <ErrorAlert title="Move failed" description={moveFetcher.data.error} />
      ) : null}
    </div>
  );
}
