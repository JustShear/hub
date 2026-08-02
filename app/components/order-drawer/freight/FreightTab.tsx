import { FreightShipmentSection } from "~/components/order-drawer/freight/FreightShipmentSection";
import type { OrderDetail } from "~/domain/orders/order-detail-query.server";

export interface FreightTabProps {
  order: OrderDetail;
  canCreateFreight: boolean;
  canDownloadFreight: boolean;
  canCancelFreight: boolean;
}

export function FreightTab({
  order,
  canCreateFreight,
  canDownloadFreight,
  canCancelFreight,
}: FreightTabProps) {
  const eligible = order.productionSummary === "COMPLETE" && !order.cancelledAt;
  const ineligibleReason = order.cancelledAt
    ? "This order is cancelled."
    : "Production must be complete before a freight label can be created.";

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="text-sm font-semibold text-ink">Freight</h3>
        <p className="mt-0.5 text-xs text-muted">
          Creating a freight label calls the real Starshipit API and writes the tracking number back
          to Shopify — there is no packing gate this milestone, so this only becomes available once
          production is complete. There is no undo with the carrier once a label is printed.
        </p>
      </section>

      <FreightShipmentSection
        orderId={order.id}
        shipments={order.freightShipments}
        eligible={eligible}
        ineligibleReason={ineligibleReason}
        canCreate={canCreateFreight}
        canDownload={canDownloadFreight}
        canCancel={canCancelFreight}
      />
    </div>
  );
}
