import { Link } from "react-router";
import type { Route } from "./+types/dev.orders";
import { db } from "~/lib/db.server";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { PageHeader } from "~/components/shared/PageHeader";
import { EmptyState } from "~/components/shared/EmptyState";

const LIST_CAP = 100;

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Raw data inspector — Just Shear Production Hub" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "raw_data.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const orders = await db.shopifyOrder.findMany({
    where: { shopId: staffUser.shopId },
    orderBy: { shopifyCreatedAt: "desc" },
    take: LIST_CAP,
    select: {
      id: true,
      orderNumber: true,
      customerEmail: true,
      shopifyCreatedAt: true,
      lastSyncedAt: true,
      _count: { select: { lines: true } },
    },
  });

  return { orders };
}

export default function DevOrdersList({ loaderData }: Route.ComponentProps) {
  const { orders } = loaderData;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Raw Data Inspector"
        description={`Developer-only. Shows exactly what was imported from Shopify — raw payloads and every line property, unfiltered. Capped at the most recent ${LIST_CAP} orders.`}
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Raw Data Inspector" }]}
      />

      {orders.length === 0 ? (
        <EmptyState
          title="No orders imported yet"
          description="Use `npm run import:order` to import one."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Customer email</th>
                <th className="px-4 py-2 font-medium">Shopify created</th>
                <th className="px-4 py-2 font-medium">Lines</th>
                <th className="px-4 py-2 font-medium">Last synced</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-border align-top last:border-0">
                  <td className="px-4 py-2">
                    <Link
                      className="text-brand-navy underline hover:no-underline"
                      to={`/dev/orders/${order.id}`}
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted">{order.customerEmail ?? "—"}</td>
                  <td className="px-4 py-2 text-muted">
                    {new Date(order.shopifyCreatedAt).toLocaleString("en-AU")}
                  </td>
                  <td className="px-4 py-2 text-muted">{order._count.lines}</td>
                  <td className="px-4 py-2 text-muted">
                    {order.lastSyncedAt
                      ? new Date(order.lastSyncedAt).toLocaleString("en-AU")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
