import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),

  layout("routes/app.tsx", [
    index("routes/home.tsx"),
    route("dashboard", "routes/dashboard.tsx"),
    route("integrations", "routes/integrations.tsx"),
    route("orders", "routes/orders.tsx", [
      route(":orderId", "routes/orders.$orderId.tsx"),
      route(":orderId/more", "routes/orders.$orderId.more.tsx"),
      route(":orderId/proof-groups", "routes/orders.$orderId.proof-groups.tsx"),
      route(":orderId/freight", "routes/orders.$orderId.freight.tsx"),
    ]),
    route("orders/column", "routes/orders.column.tsx"),
    route("warehouse", "routes/warehouse.tsx", [route(":jobId", "routes/warehouse.$jobId.tsx")]),
    route("warehouse/actions", "routes/warehouse.actions.tsx"),
    route("warehouse/report", "routes/warehouse.report.tsx"),
    route("exceptions", "routes/exceptions.tsx", [
      route(":caseId", "routes/exceptions.$caseId.tsx"),
    ]),
    route("exceptions/actions", "routes/exceptions.actions.tsx"),
    route("exceptions/report", "routes/exceptions.report.tsx"),
    route("notifications/actions", "routes/notifications.actions.tsx"),
    route("profile/actions", "routes/profile.actions.tsx"),
    route("proof-assets/:assetId", "routes/proof-assets.$assetId.tsx"),
    route("customer-response-assets/:assetId", "routes/customer-response-assets.$assetId.tsx"),
    route(
      "freight-shipments/:freightShipmentId/label",
      "routes/freight-shipments.$freightShipmentId.label.tsx",
    ),
    route("dev/orders", "routes/dev.orders.tsx"),
    route("dev/orders/:orderId", "routes/dev.orders.$orderId.tsx"),
  ]),

  route("webhooks/orders/created", "routes/webhooks.orders-created.tsx"),
  route("webhooks/orders/updated", "routes/webhooks.orders-updated.tsx"),
  route("webhooks/orders/cancelled", "routes/webhooks.orders-cancelled.tsx"),
  route("webhooks/customers/data-request", "routes/webhooks.customers-data-request.tsx"),
  route("webhooks/customers/redact", "routes/webhooks.customers-redact.tsx"),
  route("webhooks/shop/redact", "routes/webhooks.shop-redact.tsx"),

  // Public — the customer proof portal. Deliberately a sibling of the
  // webhook routes, outside layout("routes/app.tsx", ...), so it never runs
  // through requireStaffUser or renders inside the authenticated shell.
  // "respond" is a single action-only resource route (view/approve/request
  // changes, keyed by `_intent`), matching the internal drawer's own
  // one-route-many-intents convention — the GET-only page loader below
  // never performs any of these itself.
  route("proof/:token", "routes/proof.$token.tsx"),
  route("proof/:token/respond", "routes/proof.$token.respond.tsx"),
  route("proof/:token/asset/:assetId", "routes/proof.$token.asset.$assetId.tsx"),
] satisfies RouteConfig;
