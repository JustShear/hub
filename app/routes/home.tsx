import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { requireStaffUser } from "~/auth/staff-session.server";

// The dashboard is the real landing page — this route only exists so "/"
// resolves somewhere sensible for a signed-in staff member.
export async function loader({ request }: Route.LoaderArgs) {
  await requireStaffUser(request);
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for redirects from a loader
  throw redirect("/dashboard");
}
