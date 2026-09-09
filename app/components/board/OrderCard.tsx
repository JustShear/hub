/* eslint-disable react-hooks/refs -- dnd-kit's useDraggable deliberately returns plain state
   (isDragging) alongside a ref-setter (setNodeRef) and listener/attribute
   objects in one hook result; this isn't the ref-read-during-render
   anti-pattern the rule targets. */
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertCircle,
  AlertOctagon,
  CalendarClock,
  Clock,
  Flag,
  GripVertical,
  MailWarning,
  MessageSquareWarning,
  PackageSearch,
  ShieldAlert,
  Truck,
  TriangleAlert,
} from "lucide-react";
import { Link, useFetcher, useLocation } from "react-router";
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
import { PackCardFreightControls } from "~/components/board/PackCardFreightControls";

export interface OrderCardProps {
  card: BoardCard;
  canManage: boolean;
  canViewIntegrations: boolean;
  canCreateFreightShipments: boolean;
  isPending: boolean;
  onMove: (targetColumnKey: BoardColumnKey) => void;
}

// Priority, highest first: a manual cardTintOverride always wins (staff
// correcting a specific order); otherwise embroidery (blue), then the green
// placement/personalisation signal, then the general pink printing/upload
// signals, else no tint. Pulled out of the JSX below since the nested
// ternary it replaces was getting hard to read one level deeper.
function tintClassName(card: BoardCard): string {
  if (card.cardTintOverride === "BLUE") return "bg-accent-blue";
  if (card.cardTintOverride === "PINK") return "bg-accent-pink";
  if (card.cardTintOverride === "NONE") return "bg-surface";
  if (card.hasEmbroideryLineMarker) return "bg-accent-blue";
  if (card.hasGreenLineMarker) return "bg-accent-green";
  if (card.hasCustomerUpload || card.hasDecorationLineMarker) return "bg-accent-pink";
  return "bg-surface";
}

// To add a new field to the card: extend BoardCard in board-query.server.ts
// (the select + toBoardCard transform), then render it here — see
// docs/development.md "Kanban board" for the full walkthrough.
export function OrderCard({
  card,
  canManage,
  canViewIntegrations,
  canCreateFreightShipments,
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

  const isApprovedOrExportedColumn =
    card.columnKey === "proof_approved" || card.columnKey === "exported_for_print";

  const hasIndicators =
    card.isPreorder ||
    card.isWaitingOnCustomer ||
    card.hasCustomerResponseAlert ||
    card.isApprovedNotExported ||
    card.hasFailedProofDelivery ||
    card.workflowStatus === "FULFILLED" ||
    card.hasActiveFreightShipment ||
    card.workflowStatus === "READY_TO_PACK" ||
    card.hasOpenWarehouseIssue ||
    card.hasShortPickItems ||
    card.warehousePickSummary === "IN_PROGRESS" ||
    card.hasOpenExceptionCase ||
    card.hasIntegrationIssue;

  return (
    <div
      ref={draggable.setNodeRef}
      style={style}
      className={`relative flex flex-col gap-2 rounded-lg border border-border p-3 text-sm shadow-sm ${tintClassName(card)} ${draggable.isDragging ? "opacity-50" : ""} ${isPending ? "opacity-70" : ""}`}
    >
      {card.hasCustomerNote ? (
        <span
          title="Customer left a note at checkout"
          className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent-purple text-white shadow-sm"
        >
          <Flag aria-hidden="true" className="h-3 w-3" />
          <span className="sr-only">Customer left a note at checkout</span>
        </span>
      ) : null}
      {isApprovedOrExportedColumn && card.hasApprovalOrPaymentIssue ? (
        <span
          title="Not every proof is approved yet, or the order isn't paid in full"
          className="absolute -top-1.5 left-4 flex h-5 w-5 items-center justify-center rounded-full bg-error text-white shadow-sm"
        >
          <TriangleAlert aria-hidden="true" className="h-3 w-3" />
          <span className="sr-only">
            Not every proof is approved yet, or the order isn't paid in full
          </span>
        </span>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <Link
          to={{ pathname: `/orders/${card.id}`, search: location.search }}
          className="rounded text-left font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
        >
          {card.orderNumber}
        </Link>
        <PriorityBadge priority={card.priority} />
      </div>

      <CardTintOverrideSelector
        orderId={card.id}
        cardTintOverride={card.cardTintOverride}
        disabled={!canManage || isPending}
      />

      <p className="text-ink">{card.customerName ?? "No customer name"}</p>

      <p className="text-xs text-muted">
        Ordered {formatAuDate(card.shopifyCreatedAt)} · {card.daysInState} day
        {card.daysInState === 1 ? "" : "s"} in this state
      </p>

      <CardThumbnails lines={card.lines} totalLineCount={card.lineCount} />

      {card.tags.length > 0 ? <TagChips tags={card.tags} /> : null}

      {isApprovedOrExportedColumn && card.proofGroupSummary.latestApprovedThumbnail ? (
        <a
          href={`/proof-assets/${card.proofGroupSummary.latestApprovedThumbnail.assetId}`}
          target="_blank"
          rel="noreferrer"
          aria-label="View full-size proof"
          onClick={(e) => {
            // Stop the click reaching the draggable card wrapper.
            e.stopPropagation();
          }}
          className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
        >
          <img
            src={`/proof-assets/${card.proofGroupSummary.latestApprovedThumbnail.assetId}`}
            alt=""
            loading="lazy"
            className="max-h-48 w-full rounded border border-border bg-page object-contain"
          />
        </a>
      ) : null}

      <div className="flex items-center gap-2 text-xs text-muted">
        {!isApprovedOrExportedColumn && card.proofGroupSummary.latestThumbnail ? (
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
                card.proofGroupSummary.waitingOnCustomerCount > 0
                  ? ` · ${card.proofGroupSummary.waitingOnCustomerCount} awaiting customer`
                  : ""
              }${
                card.proofGroupSummary.changesRequestedCount > 0
                  ? ` · ${card.proofGroupSummary.changesRequestedCount} changes requested`
                  : ""
              }${
                card.proofGroupSummary.approvedCount > 0
                  ? ` · ${card.proofGroupSummary.approvedCount} approved`
                  : ""
              }${
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
          {card.hasFailedProofDelivery ? (
            <IndicatorChip icon={MailWarning} label="Proof email failed to send" tone="warning" />
          ) : null}
          {card.hasActiveFreightShipment ? (
            <IndicatorChip icon={Truck} label="Freight label created" tone="neutral" />
          ) : null}
          {card.workflowStatus === "READY_TO_PACK" ? (
            <IndicatorChip icon={PackageSearch} label="Ready to pack" tone="success" />
          ) : card.hasOpenWarehouseIssue ? (
            <Link
              to="/warehouse"
              className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
            >
              <IndicatorChip icon={PackageSearch} label="Warehouse issue" tone="error" />
            </Link>
          ) : card.hasShortPickItems ? (
            <IndicatorChip icon={PackageSearch} label="Short pick" tone="warning" />
          ) : card.warehousePickSummary === "IN_PROGRESS" ? (
            <IndicatorChip icon={PackageSearch} label="Picking" tone="neutral" />
          ) : null}
          {card.hasOpenExceptionCase ? (
            <Link
              to="/exceptions"
              className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
            >
              <IndicatorChip icon={AlertOctagon} label="Exception case" tone="error" />
            </Link>
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

      {card.workflowStatus === "READY_TO_PACK" ? (
        <PackCardFreightControls
          orderId={card.id}
          isCancelled={card.isCancelled}
          existingShipment={card.freightShipment}
          canCreate={canCreateFreightShipments}
        />
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

const TINT_OPTIONS: { value: "AUTO" | "PINK" | "BLUE" | "NONE"; label: string }[] = [
  { value: "AUTO", label: "Auto colour" },
  { value: "PINK", label: "Pink" },
  { value: "BLUE", label: "Blue" },
  { value: "NONE", label: "No tint" },
];

// A manual, Hub-only override for the card's tint (see
// update-card-tint-override.server.ts) — never synced to Shopify. "Auto"
// defers to hasEmbroideryLineMarker/hasCustomerUpload/hasDecorationLineMarker;
// Pink/Blue/No tint force that colour regardless, for when an order changes
// after the fact and those automatic signals go stale.
function CardTintOverrideSelector({
  orderId,
  cardTintOverride,
  disabled,
}: {
  orderId: string;
  cardTintOverride: "PINK" | "BLUE" | "NONE" | null;
  disabled: boolean;
}) {
  const fetcher = useFetcher();
  // Optimistic: reflect the in-flight value immediately rather than waiting
  // for the board to revalidate.
  const value = fetcher.formData
    ? (fetcher.formData.get("cardTintOverride") as string)
    : (cardTintOverride ?? "AUTO");

  return (
    <label
      className="flex items-center gap-1.5 text-xs font-medium text-ink"
      onClick={(e) => {
        // Stop the click reaching the draggable card wrapper.
        e.stopPropagation();
      }}
    >
      Colour
      <select
        value={value}
        disabled={disabled || fetcher.state !== "idle"}
        onChange={(e) => {
          void fetcher.submit(
            {
              _intent: "setCardTintOverride",
              orderId,
              cardTintOverride: e.target.value,
            },
            { method: "post" },
          );
        }}
        className="rounded border border-border bg-page px-1 py-0.5 text-xs text-ink"
      >
        {TINT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
