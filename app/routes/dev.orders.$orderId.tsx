import type { Route } from "./+types/dev.orders.$orderId";
import { db } from "~/lib/db.server";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { PageHeader } from "~/components/shared/PageHeader";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData.order.orderNumber} — Raw data inspector` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "raw_data.view")) {
    // React Router's documented convention: throwing a Response triggers the
    // route's ErrorBoundary. Not an Error instance by design.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw new Response("Forbidden", { status: 403 });
  }

  const order = await db.shopifyOrder.findFirst({
    where: { id: params.orderId, shopId: staffUser.shopId },
    include: {
      lines: {
        include: {
          properties: { orderBy: { sortOrder: "asc" } },
          artworkLinks: { include: { asset: true } },
        },
      },
    },
  });

  if (!order) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw new Response("Order not found", { status: 404 });
  }

  return { order };
}

export default function DevOrderDetail({ loaderData }: Route.ComponentProps) {
  const { order } = loaderData;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={order.orderNumber}
        description={`Raw data — Shopify GID: ${order.shopifyOrderGid}`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Raw Data Inspector", href: "/dev/orders" },
          { label: order.orderNumber },
        ]}
      />

      <section>
        <h2 className="text-lg font-semibold text-ink">Order lines &amp; properties</h2>
        {order.lines.length === 0 ? (
          <p className="mt-2 text-muted">No lines imported for this order.</p>
        ) : (
          order.lines.map((line) => (
            <div key={line.id} className="mt-4 rounded-lg border border-border bg-surface p-4">
              <h3 className="font-medium text-ink">
                {line.productTitle}
                {line.variantTitle ? ` — ${line.variantTitle}` : ""}{" "}
                <span className="text-sm text-muted">
                  (qty {line.quantity}
                  {line.sku ? `, SKU ${line.sku}` : ""})
                </span>
              </h3>

              {line.properties.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No custom properties on this line.</p>
              ) : (
                <table className="mt-3 w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted">
                      <th className="py-1 pr-4 font-medium">Name</th>
                      <th className="py-1 pr-4 font-medium">Value</th>
                      <th className="py-1 pr-4 font-medium">Detected type</th>
                      <th className="py-1 pr-4 font-medium">Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {line.properties.map((property) => (
                      <tr
                        key={property.id}
                        className="border-b border-border align-top last:border-0"
                      >
                        <td className="py-1 pr-4 text-ink">{property.name}</td>
                        <td className="py-1 pr-4 break-all text-ink">{property.value}</td>
                        <td className="py-1 pr-4 text-muted">{property.detectedType}</td>
                        <td className="py-1 pr-4 text-muted">{property.sortOrder ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {line.artworkLinks.length > 0 ? (
                <div className="mt-3">
                  <h4 className="text-sm font-medium text-ink">Linked artwork assets</h4>
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink">
                    {line.artworkLinks.map((link) => (
                      <li key={link.id} className="break-all">
                        {link.asset.sourceUrl} —{" "}
                        <span className="text-muted">{link.asset.sourceType}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ))
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink">Raw Shopify payload</h2>
        <pre className="mt-2 max-h-[32rem] overflow-auto rounded-lg bg-ink p-4 text-xs text-page">
          {JSON.stringify(order.rawPayload, null, 2)}
        </pre>
      </section>
    </div>
  );
}
