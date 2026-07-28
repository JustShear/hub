import type { Route } from "./+types/webhooks.customers-data-request";
import { handleCustomerDataRequest } from "~/domain/privacy/handle-privacy-webhook.server";

export async function action({ request }: Route.ActionArgs) {
  return handleCustomerDataRequest(request);
}
