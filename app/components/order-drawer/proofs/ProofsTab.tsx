import { EmptyState } from "~/components/shared/EmptyState";
import { PROOF_SUMMARY_LABELS } from "~/domain/orders/labels";
import { summarizeProofGroupsForBoard } from "~/domain/proofs/board-summary";
import { CreateProofGroupDialog } from "~/components/order-drawer/proofs/CreateProofGroupDialog";
import { ProofGroupCard } from "~/components/order-drawer/proofs/ProofGroupCard";
import type { OrderDetail } from "~/domain/orders/order-detail-query.server";

export interface ProofsTabProps {
  order: OrderDetail;
  assignableStaff: { id: string; name: string }[];
  canCreateProofGroups: boolean;
  canUpdateProofGroups: boolean;
  canCancelProofGroups: boolean;
  canUpdateProofRequirement: boolean;
  canCreateProofVersions: boolean;
  canUpdateProofVersionStatus: boolean;
  canAssignProofArtwork: boolean;
  canCreateProofNotes: boolean;
}

export function ProofsTab({
  order,
  assignableStaff,
  canCreateProofGroups,
  canUpdateProofGroups,
  canCancelProofGroups,
  canUpdateProofRequirement,
  canCreateProofVersions,
  canUpdateProofVersionStatus,
  canAssignProofArtwork,
  canCreateProofNotes,
}: ProofsTabProps) {
  const nonCancelledGroups = order.proofGroups.filter((g) => g.status !== "CANCELLED");
  const counts = summarizeProofGroupsForBoard(
    order.proofGroups.map((g) => ({
      status: g.status,
      hasOpenIntegrationFailure: g.hasOpenIntegrationFailure,
    })),
  );
  const cancelledCount = order.proofGroups.length - nonCancelledGroups.length;
  const blockedGroups = nonCancelledGroups.filter((g) => g.hasOpenIntegrationFailure);

  const lineOptions = order.lines.map((line) => ({
    id: line.id,
    productTitle: line.productTitle,
    variantTitle: line.variantTitle,
    sku: line.sku,
    imageUrl: line.imageUrl,
    quantity: line.quantity,
  }));

  const assetOptionMap = new Map<string, { id: string; label: string }>();
  for (const line of order.lines) {
    for (const link of line.artworkLinks) {
      if (!assetOptionMap.has(link.asset.id)) {
        assetOptionMap.set(link.asset.id, {
          id: link.asset.id,
          label: link.asset.originalFilename ?? link.asset.sourceUrl ?? "Untitled file",
        });
      }
    }
  }
  const assetOptions = [...assetOptionMap.values()];

  return (
    <div className="flex flex-col gap-4">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              Proof summary: {PROOF_SUMMARY_LABELS[order.proofSummary]}
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              {order.proofGroups.length} group{order.proofGroups.length === 1 ? "" : "s"} ·{" "}
              {counts.readyCount} ready · {counts.requiringWorkCount} in progress ·{" "}
              {counts.noProofRequiredCount} no proof required · {counts.blockedCount} blocked ·{" "}
              {cancelledCount} cancelled
            </p>
          </div>
          {canCreateProofGroups ? (
            <CreateProofGroupDialog
              orderId={order.id}
              lineOptions={lineOptions}
              assetOptions={assetOptions}
              assignableStaff={assignableStaff}
            />
          ) : null}
        </div>
        {blockedGroups.length > 0 ? (
          <p className="mt-2 text-xs text-error">
            {blockedGroups.length} proof group{blockedGroups.length === 1 ? "" : "s"} blocked by an
            unresolved upload or storage issue — see the group below for details.
          </p>
        ) : null}
      </section>

      {order.proofGroups.length === 0 ? (
        <EmptyState
          title="No proof groups yet"
          description={
            canCreateProofGroups
              ? "Create a proof group to start organising this order's artwork."
              : "No proof groups have been created for this order yet."
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {order.proofGroups.map((group) => (
            <ProofGroupCard
              key={group.id}
              orderId={order.id}
              group={group}
              availableLines={lineOptions}
              availableAssets={assetOptions}
              assignableStaff={assignableStaff}
              canUpdate={canUpdateProofGroups}
              canCancel={canCancelProofGroups}
              canUpdateRequirement={canUpdateProofRequirement}
              canCreateVersions={canCreateProofVersions}
              canUpdateVersionStatus={canUpdateProofVersionStatus}
              canAssignArtwork={canAssignProofArtwork}
              canCreateNotes={canCreateProofNotes}
            />
          ))}
        </div>
      )}
    </div>
  );
}
