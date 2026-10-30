import type { Route } from "./+types/customers";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { listCustomers } from "~/domain/customers/customer-query.server";
import { CustomerListPage } from "~/components/customers/CustomerListPage";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Customers — Just Shear Production Hub" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);
  // The customer file is all proof images, which are served under this same
  // permission - so anyone who can't open a proof file can't open this page.
  if (!hasPermission(staffUser, "proof_versions.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const search = new URL(request.url).searchParams.get("q")?.slice(0, 100) ?? "";
  const customers = await listCustomers({ shopId: staffUser.shopId, search });
  return { customers, search };
}

export default function CustomersRoute({ loaderData }: Route.ComponentProps) {
  return <CustomerListPage {...loaderData} />;
}
