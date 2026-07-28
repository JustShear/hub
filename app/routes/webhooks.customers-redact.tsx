import type { Route } from "./+types/webhooks.customers-redact";
import { handleCustomerRedact } from "~/domain/privacy/handle-privacy-webhook.server";

export async function action({ request }: Route.ActionArgs) {
  return handleCustomerRedact(request);
}
