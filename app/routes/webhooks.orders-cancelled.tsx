import type { Route } from "./+types/webhooks.orders-cancelled";
import { handleOrderWebhook } from "~/domain/orders/handle-order-webhook.server";

export async function action({ request }: Route.ActionArgs) {
  return handleOrderWebhook(request, "orders/cancelled");
}
