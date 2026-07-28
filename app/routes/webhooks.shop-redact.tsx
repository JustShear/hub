import type { Route } from "./+types/webhooks.shop-redact";
import { handleShopRedact } from "~/domain/privacy/handle-privacy-webhook.server";

export async function action({ request }: Route.ActionArgs) {
  return handleShopRedact(request);
}
