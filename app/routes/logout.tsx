import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { destroyUserSession } from "~/auth/staff-session.server";

// POST-only by design — logout is a form submission, not a link, so it
// can't be triggered by prefetch, crawlers, or a stray GET.
export async function action({ request }: Route.ActionArgs) {
  return destroyUserSession(request);
}

export function loader() {
  return redirect("/dashboard");
}
