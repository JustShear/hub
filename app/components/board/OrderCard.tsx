/* eslint-disable react-hooks/refs -- dnd-kit's useDraggable deliberately returns plain state
   (isDragging) alongside a ref-setter (setNodeRef) and listener/attribute
   objects in one hook result; this isn't the ref-read-during-render
   anti-pattern the rule targets. */
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertCircle,
  CalendarClock,
  Clock,
  GripVertical,
  MessageSquareWarning,
  ShieldAlert,
} from "lucide-react";
import { Link, useLocation } from "react-router";
import type { BoardCard } from "~/domain/orders/board-query.server";
import type { BoardColumnKey } from "~/domain/orders/board-columns";
import { PROOF_SUMMARY_LABELS } from "~/domain/orders/labels";
import { formatAuDate } from "~/lib/dates";
import {
  DueDateIndicator,
  IndicatorChip,
  PriorityBadge,
  TagChips,
} from "~/components/board/CardBadges";
import { CardThumbnails } from "~/components/board/CardThumbnails";
import { MoveToMenu } from "~/components/board/MoveToMenu";

export interface OrderCardProps {
  card: BoardCard;
  canManage: boolean;
  canViewIntegrations: boolean;
  isPending: boolean;
  onMove: (targetColumnKey: BoardColumnKey) => void;
}

// To add a new field to the card: extend BoardCard in board-query.server.ts
// (the select + toBoardCard transform), then render it here — see
// docs/development.md "Kanban board" for the full walkthrough.
export function OrderCard({
  card,
  canManage,
  canViewIntegrations,
  isPending,
  onMove,
}: OrderCardProps) {
  // Preserves the board's current filters/sort/view in the URL so closing
  // the drawer (browser back) returns to exactly the same board state —
  // the drawer is a real nested route (app/routes/orders.$orderId.tsx), not
  // client-only state.
  const location = useLocation();
  const draggable = useDraggable({
    id: card.id,
    data: { fromColumnKey: card.columnKey, card },
    disabled: !canManage || isPending,
  });

  const style = draggable.transform
    ? { transform: CSS.Translate.toString(draggable.transform) }
    : undefined;

  const hasIndicators =
    card.isPreorder ||
    card.isWaitingOnCustomer ||
    card.hasCustomerResponseAlert ||
    card.isApprovedNotExported ||
    card.hasIntegrationIssue;

  return (
    <div
      ref={draggable.setNodeRef}
      style={style}
      className={`flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm shadow-sm ${
        draggable.isDragging ? "opacity-50" : ""
      } ${isPending ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          to={{ pathname: `/orders/${card.id}`, search: location.search }}
          className="rounded text-left font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
        >
          {card.orderNumber}
        </Link>
        <PriorityBadge priority={card.priority} />
      </div>

      <p className="text-ink">{card.customerName ?? "No customer name"}</p>

      <p className="text-xs text-muted">
        Ordered {formatAuDate(card.shopifyCreatedAt)} · {card.daysInState} day
        {card.daysInState === 1 ? "" : "s"} in this state
      </p>

      <CardThumbnails lines={card.lines} totalLineCount={card.lineCount} />

      {card.tags.length > 0 ? <TagChips tags={card.tags} /> : null}

      <div className="flex items-center gap-2 text-xs text-muted">
        {card.proofGroupSummary.latestThumbnail ? (
          <img
            src={`/proof-assets/${card.proofGroupSummary.latestThumbnail.assetId}`}
            alt=""
            loading="lazy"
            className="h-6 w-6 shrink-0 rounded border border-border object-cover"
          />
        ) : null}
        <p>
          {PROOF_SUMMARY_LABELS[card.proofSummary]}
          {card.proofGroupCount > 0
            ? ` · ${card.proofGroupSummary.readyCount} ready · ${card.proofGroupSummary.requiringWorkCount} in progress${
                card.proofGroupSummary.noProofRequiredCount > 0
                  ? ` · ${card.proofGroupSummary.noProofRequiredCount} no proof required`
                  : ""
              }${card.proofGroupSummary.blockedCount > 0 ? ` · ${card.proofGroupSummary.blockedCount} blocked` : ""}`
            : ""}
        </p>
      </div>
      {card.proofGroupSummary.assignedStaffNames.length > 0 ? (
        <p className="text-xs text-muted">
          Artwork: {card.proofGroupSummary.assignedStaffNames.join(", ")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <DueDateIndicator dueDate={card.nearestDueDate} />
        <span className="text-muted">
          {card.assignment ? `Assigned: ${card.assignment.staffUserName}` : "Unassigned"}
        </span>
      </div>

      {hasIndicators ? (
        <div className="flex flex-wrap gap-1.5">
          {card.isPreorder ? (
            <IndicatorChip icon={CalendarClock} label="Preorder" tone="neutral" />
          ) : null}
          {card.isWaitingOnCustomer ? (
            <IndicatorChip icon={Clock} label="Waiting on customer" tone="warning" />
          ) : null}
          {card.hasCustomerResponseAlert ? (
            <IndicatorChip icon={MessageSquareWarning} label="Changes requested" tone="warning" />
          ) : null}
          {card.isApprovedNotExported ? (
            <IndicatorChip icon={AlertCircle} label="Approved — not yet exported" tone="warning" />
          ) : null}
          {card.hasIntegrationIssue ? (
            canViewIntegrations ? (
              <Link
                to="/integrations"
                className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
              >
                <IndicatorChip icon={ShieldAlert} label="Integration issue" tone="error" />
              </Link>
            ) : (
              <IndicatorChip icon={ShieldAlert} label="Integration issue" tone="error" />
            )
          ) : null}
        </div>
      ) : null}

      {canManage ? (
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            {...draggable.listeners}
            {...draggable.attributes}
            disabled={isPending}
            aria-label={`Drag ${card.orderNumber} to move it to another column`}
            className="flex h-7 w-7 cursor-grab items-center justify-center rounded-md border border-border text-muted hover:bg-page active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GripVertical aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
          <MoveToMenu
            currentWorkflowStatus={card.workflowStatus}
            currentColumnKey={card.columnKey}
            onMove={onMove}
            disabled={isPending}
          />
        </div>
      ) : null}
    </div>
  );
}
