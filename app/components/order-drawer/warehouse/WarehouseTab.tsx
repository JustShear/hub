import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { WAREHOUSE_PICK_JOB_STATUS_LABELS } from "~/domain/warehouse/labels";
import type { OrderDetail } from "~/domain/orders/order-detail-query.server";
import type { WarehousePickJobStatus } from "@prisma/client";

const STATUS_TONE: Record<WarehousePickJobStatus, BadgeTone> = {
  QUEUED: "neutral",
  IN_PROGRESS: "neutral",
  HANDED_OVER: "success",
  CANCELLED: "neutral",
};

export interface WarehouseTabProps {
  order: OrderDetail;
}

// Read-only summary + link out to the full workstation — mirrors the
// Production tab's own "Production jobs" section exactly. No pick/mark-
// short/handover controls duplicated here.
export function WarehouseTab({ order }: WarehouseTabProps) {
  const job = order.warehousePickJob;

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="text-sm font-semibold text-ink">Warehouse picking</h3>
        <p className="mt-0.5 text-xs text-muted">
          A pick job is created automatically once this order's production is complete — one line
          per order item. Full pick/short/issue/handover controls live in the warehouse workstation.
        </p>
      </section>

      {!job ? (
        <p className="text-sm text-muted">
          No pick job yet — one is created automatically once production reaches Complete.
        </p>
      ) : (
        <Link
          to={`/warehouse/${job.id}`}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3 hover:bg-page"
        >
          <Badge tone={STATUS_TONE[job.status]}>
            {WAREHOUSE_PICK_JOB_STATUS_LABELS[job.status]}
          </Badge>
          <span className="text-sm text-ink">
            {job.pickedLineCount} / {job.lineCount} lines
          </span>
          {job.hasShortItem ? <Badge tone="warning">Has a short line</Badge> : null}
          {job.hasOpenIssue ? (
            <span title="Open issue" className="text-warning">
              <AlertTriangle aria-hidden="true" className="h-4 w-4" />
              <span className="sr-only">This pick job has an open issue</span>
            </span>
          ) : null}
          <span className="text-xs text-muted">{job.assignedStaffName ?? "Unassigned"}</span>
        </Link>
      )}
    </div>
  );
}
