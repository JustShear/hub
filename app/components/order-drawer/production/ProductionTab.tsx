import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "~/components/shared/EmptyState";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { PriorityBadge } from "~/components/board/CardBadges";
import { PROOF_GROUP_STATUS_LABELS } from "~/domain/proofs/labels";
import {
  DECORATION_WORKSTREAM_LABELS,
  ORDER_PRODUCTION_SUMMARY_LABELS,
  PRODUCTION_JOB_STATUS_LABELS,
} from "~/domain/production/labels";
import { formatAuDate } from "~/lib/dates";
import { ProductionArtworkSection } from "~/components/order-drawer/production/ProductionArtworkSection";
import { ExportBatchSection } from "~/components/order-drawer/production/ExportBatchSection";
import type { OrderDetail } from "~/domain/orders/order-detail-query.server";
import type { ProductionJobStatus } from "@prisma/client";

export interface ProductionTabProps {
  order: OrderDetail;
  canCreateProductionArtwork: boolean;
  canUpdateProductionArtwork: boolean;
  canCancelProductionArtwork: boolean;
  canCreateExportBatch: boolean;
  canDownloadExportBatches: boolean;
  canReexportBatch: boolean;
  canViewProductionQueue: boolean;
}

const JOB_STATUS_TONE: Record<ProductionJobStatus, BadgeTone> = {
  QUEUED: "neutral",
  READY: "neutral",
  IN_PROGRESS: "neutral",
  PAUSED: "warning",
  BLOCKED: "error",
  AWAITING_QUALITY_CHECK: "warning",
  COMPLETE: "success",
  CANCELLED: "neutral",
};

const EXPORT_ELIGIBLE_GROUP_STATUSES = new Set([
  "APPROVED",
  "NO_PROOF_REQUIRED",
  "READY_FOR_EXPORT",
  "EXPORTED_FOR_PRINT",
]);

export function ProductionTab({
  order,
  canCreateProductionArtwork,
  canUpdateProductionArtwork,
  canCancelProductionArtwork,
  canCreateExportBatch,
  canDownloadExportBatches,
  canReexportBatch,
  canViewProductionQueue,
}: ProductionTabProps) {
  const eligibleGroups = order.proofGroups.filter((g) =>
    EXPORT_ELIGIBLE_GROUP_STATUSES.has(g.status),
  );
  const readyForExportGroups = order.proofGroups
    .filter((g) => g.productionArtworks[0]?.status === "READY_FOR_EXPORT")
    .map((g) => ({ id: g.id, name: g.name }));

  const lineOptions = order.lines.map((line) => ({
    id: line.id,
    label: `${line.productTitle}${line.variantTitle ? ` - ${line.variantTitle}` : ""}`,
    quantity: line.quantity,
  }));

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="text-sm font-semibold text-ink">Production artwork</h3>
        <p className="mt-0.5 text-xs text-muted">
          A proof group becomes eligible once its current version is customer-approved, or it's
          legitimately marked no-proof-required.
        </p>
      </section>

      {eligibleGroups.length === 0 ? (
        <EmptyState
          title="No export-eligible proof groups yet"
          description="Proof groups appear here once a version is approved, or the group is marked no-proof-required."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {eligibleGroups.map((group) => (
            <div key={group.id} className="rounded-lg border border-border bg-page p-3">
              <p className="text-sm font-semibold text-ink">
                {group.name}{" "}
                <span className="font-normal text-muted">
                  ({PROOF_GROUP_STATUS_LABELS[group.status]})
                </span>
              </p>
              <div className="mt-2">
                <ProductionArtworkSection
                  orderId={order.id}
                  proofGroupId={group.id}
                  artworks={group.productionArtworks}
                  lineOptions={lineOptions}
                  canCreate={canCreateProductionArtwork}
                  canUpdate={canUpdateProductionArtwork}
                  canCancel={canCancelProductionArtwork}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <ExportBatchSection
        orderId={order.id}
        batches={order.exportBatches}
        eligibleGroups={readyForExportGroups}
        canCreate={canCreateExportBatch}
        canDownload={canDownloadExportBatches}
        canReexport={canReexportBatch}
      />

      {canViewProductionQueue ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-ink">Production jobs</h4>
            <Badge tone="neutral">{ORDER_PRODUCTION_SUMMARY_LABELS[order.productionSummary]}</Badge>
          </div>
          <p className="text-xs text-muted">
            One job per decoration method per export batch — the exact artwork revisions used are
            fixed at creation and never change, even if a newer revision is exported later. Full
            start/pause/quantity/quality-check controls live in the production workstation.
          </p>
          {order.productionJobs.length === 0 ? (
            <p className="text-sm text-muted">
              No production jobs yet — a job is created automatically once artwork is exported for
              print.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {order.productionJobs.map((job) => (
                <Link
                  key={job.id}
                  to={`/production/${job.id}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3 hover:bg-page"
                >
                  <span className="font-medium text-ink">Job {job.jobNumber}</span>
                  <Badge tone={JOB_STATUS_TONE[job.status]}>
                    {PRODUCTION_JOB_STATUS_LABELS[job.status]}
                  </Badge>
                  <Badge tone="neutral">{DECORATION_WORKSTREAM_LABELS[job.decorationMethod]}</Badge>
                  <PriorityBadge priority={job.priority} />
                  {job.hasOpenIssue ? (
                    <span title="Open issue" className="text-warning">
                      <AlertTriangle aria-hidden="true" className="h-4 w-4" />
                      <span className="sr-only">This job has an open issue</span>
                    </span>
                  ) : null}
                  <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted">
                    <span>
                      {job.completedQuantity} / {job.totalQuantity}
                    </span>
                    <span>{job.assignedStaffName ?? "Unassigned"}</span>
                    {job.dueDate ? <span>Due {formatAuDate(job.dueDate)}</span> : null}
                    <span>Batch {job.exportBatchNumber}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
