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
    ]),
    route("orders/column", "routes/orders.column.tsx"),
    route("proof-assets/:assetId", "routes/proof-assets.$assetId.tsx"),
    route("dev/orders", "routes/dev.orders.tsx"),
    route("dev/orders/:orderId", "routes/dev.orders.$orderId.tsx"),
  ]),

  route("webhooks/orders/created", "routes/webhooks.orders-created.tsx"),
  route("webhooks/orders/updated", "routes/webhooks.orders-updated.tsx"),
  route("webhooks/orders/cancelled", "routes/webhooks.orders-cancelled.tsx"),
  route("webhooks/customers/data-request", "routes/webhooks.customers-data-request.tsx"),
  route("webhooks/customers/redact", "routes/webhooks.customers-redact.tsx"),
  route("webhooks/shop/redact", "routes/webhooks.shop-redact.tsx"),
] satisfies RouteConfig;
