import type { Route } from "./+types/customers.$customerKey";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { parseCustomerKey } from "~/domain/customers/customer-key";
import { loadCustomerProofFile } from "~/domain/customers/customer-query.server";
import { CustomerProofFilePage } from "~/components/customers/CustomerProofFilePage";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData.file.customer.name ?? "Customer";
  return [{ title: `${name} — Just Shear Production Hub` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);
  if (!hasPermission(staffUser, "proof_versions.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const identity = parseCustomerKey(params.customerKey);
  const file = identity
    ? await loadCustomerProofFile({ shopId: staffUser.shopId, identity })
    : null;
  if (!file) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Customer not found", { status: 404 });
  }

  return { file };
}

export default function CustomerProofFileRoute({ loaderData }: Route.ComponentProps) {
  return <CustomerProofFilePage file={loaderData.file} />;
}
