import type { OrderDetail } from "~/domain/orders/order-detail-query.server";
import { AddressBlock } from "~/components/order-drawer/AddressBlock";
import { formatAuDate, formatAuDateTime } from "~/lib/dates";

export interface ShopifyTabProps {
  order: OrderDetail;
  shopDomain: string | null;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-muted">{label}</h4>
      <p className="mt-1 break-words text-sm text-ink">{value}</p>
    </div>
  );
}

interface ParsedFulfillment {
  id: string | null;
  status: string | null;
  createdAt: string | null;
  trackingInfo: { number: string | null; url: string | null; company: string | null }[];
}

function parseFulfillments(value: unknown): ParsedFulfillment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const trackingRaw = Array.isArray(record.trackingInfo) ? record.trackingInfo : [];
    return [
      {
        id: typeof record.id === "string" ? record.id : null,
        status: typeof record.status === "string" ? record.status : null,
        createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
        trackingInfo: trackingRaw.flatMap((t) => {
          if (!t || typeof t !== "object") return [];
          const track = t as Record<string, unknown>;
          return [
            {
              number: typeof track.number === "string" ? track.number : null,
              url: typeof track.url === "string" ? track.url : null,
              company: typeof track.company === "string" ? track.company : null,
            },
          ];
        }),
      },
    ];
  });
}

function parseDiscountCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export function ShopifyTab({ order, shopDomain }: ShopifyTabProps) {
  const fulfillments = parseFulfillments(order.fulfillments);
  const discountCodes = parseDiscountCodes(order.discountCodes);
  const adminUrl =
    shopDomain && order.shopifyLegacyOrderId
      ? `https://${shopDomain}/admin/orders/${order.shopifyLegacyOrderId}`
      : null;

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Shopify order record (read only)</h3>
          {adminUrl ? (
            <a
              href={adminUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand-navy hover:underline"
            >
              Open in Shopify Admin
            </a>
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Order name" value={order.orderNumber} />
          <Field label="Order ID" value={order.shopifyOrderGid} />
          <Field label="Legacy order ID" value={order.shopifyLegacyOrderId ?? "Not available"} />
          <Field label="Created (Shopify)" value={formatAuDateTime(order.shopifyCreatedAt)} />
          <Field
            label="Updated (Shopify)"
            value={
              order.shopifyUpdatedAt ? formatAuDateTime(order.shopifyUpdatedAt) : "Not available"
            }
          />
          <Field label="Last imported" value={formatAuDateTime(order.createdAt)} />
          <Field
            label="Last successful sync"
            value={order.lastSyncedAt ? formatAuDateTime(order.lastSyncedAt) : "Never synced"}
          />
          <Field label="Financial status" value={order.financialStatus ?? "Unknown"} />
          <Field label="Fulfillment status" value={order.fulfillmentStatus ?? "Unfulfilled"} />
          <Field label="Currency" value={order.currencyCode ?? "Unknown"} />
          <Field label="Subtotal" value={order.subtotalPrice ?? "—"} />
          <Field label="Total" value={order.totalPrice ?? "—"} />
          <Field label="Total discounts" value={order.totalDiscounts ?? "—"} />
          <Field label="Total tax" value={order.totalTax ?? "—"} />
          <Field label="Shipping method" value={order.shippingMethod ?? "Not specified"} />
        </div>

        {order.cancelledAt ? (
          <div className="mt-4">
            <h4 className="text-xs font-medium text-muted">Cancellation</h4>
            <p className="mt-1 text-sm text-ink">
              Cancelled {formatAuDateTime(order.cancelledAt)}
              {order.cancelReason ? ` — ${order.cancelReason}` : ""}
            </p>
          </div>
        ) : null}

        {discountCodes.length > 0 ? (
          <div className="mt-4">
            <h4 className="text-xs font-medium text-muted">Discount codes</h4>
            <p className="mt-1 text-sm text-ink">{discountCodes.join(", ")}</p>
          </div>
        ) : null}

        {order.tags.length > 0 ? (
          <div className="mt-4">
            <h4 className="text-xs font-medium text-muted">Tags</h4>
            <div className="mt-1 flex flex-wrap gap-1">
              {order.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border bg-page px-2 py-0.5 text-xs text-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <AddressBlock value={order.shippingAddress} label="Shipping address" />
        <AddressBlock value={order.billingAddress} label="Billing address" />
      </section>

      {fulfillments.length > 0 ? (
        <section>
          <h4 className="text-xs font-medium text-muted">Fulfillments</h4>
          <div className="mt-2 flex flex-col gap-2">
            {fulfillments.map((fulfillment, index) => (
              <div
                key={fulfillment.id ?? index}
                className="rounded-lg border border-border bg-surface p-3 text-sm"
              >
                <p className="text-ink">
                  {fulfillment.status ?? "Unknown status"}
                  {fulfillment.createdAt ? ` · ${formatAuDate(fulfillment.createdAt)}` : ""}
                </p>
                {fulfillment.trackingInfo.map((track, trackIndex) => (
                  <p key={trackIndex} className="mt-1 text-xs text-muted">
                    {track.company ?? "Carrier unknown"}
                    {track.number ? ` — ${track.number}` : ""}
                    {track.url ? (
                      <a
                        href={track.url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-brand-navy hover:underline"
                      >
                        Track
                      </a>
                    ) : null}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
