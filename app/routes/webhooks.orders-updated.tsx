import type { Route } from "./+types/webhooks.orders-updated";
import { handleOrderWebhook } from "~/domain/orders/handle-order-webhook.server";

export async function action({ request }: Route.ActionArgs) {
  return handleOrderWebhook(request, "orders/updated");
}
