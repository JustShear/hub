import type { Route } from "./+types/exceptions.report";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { getExceptionsReport } from "~/domain/exceptions/report.server";
import { ExceptionsReportPage } from "~/components/exceptions/ExceptionsReportPage";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Exceptions Reporting — Just Shear Production Hub" }];
}

const DEFAULT_RANGE_DAYS = 30;

function parseDateRange(searchParams: URLSearchParams): { from: Date; to: Date } {
  const now = new Date();
  const toRaw = searchParams.get("to");
  const fromRaw = searchParams.get("from");
  const to = toRaw && !Number.isNaN(Date.parse(toRaw)) ? new Date(toRaw) : now;
  const defaultFrom = new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);
  const from = fromRaw && !Number.isNaN(Date.parse(fromRaw)) ? new Date(fromRaw) : defaultFrom;
  return { from, to };
}

export async function loader({ request }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "exception_cases.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const { from, to } = parseDateRange(url.searchParams);
  const report = await getExceptionsReport({ shopId: staffUser.shopId, from, to });

  return { report };
}

export default function ExceptionsReportRoute({ loaderData }: Route.ComponentProps) {
  return <ExceptionsReportPage report={loaderData.report} />;
}
