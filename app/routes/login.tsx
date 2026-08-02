import { Form, redirect } from "react-router";
import type { Route } from "./+types/login";
import { db } from "~/lib/db.server";
import { authenticateStaffUser } from "~/auth/authenticate.server";
import { createUserSession, getStaffUserId } from "~/auth/staff-session.server";
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  recordFailedLoginAttempt,
} from "~/auth/login-rate-limit.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Sign in — Just Shear Production Hub" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const existingStaffUserId = await getStaffUserId(request);
  if (existingStaffUserId) {
    return redirect("/dashboard");
  }

  const redirectTo = new URL(request.url).searchParams.get("redirectTo") ?? "/dashboard";
  return { redirectTo };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");
  const redirectToValue = formData.get("redirectTo");

  if (
    typeof emailValue !== "string" ||
    typeof passwordValue !== "string" ||
    !emailValue ||
    !passwordValue
  ) {
    return { error: "Enter your email and password." };
  }

  const email = emailValue;
  const password = passwordValue;
  const redirectTo =
    typeof redirectToValue === "string" && redirectToValue ? redirectToValue : "/dashboard";
  const requestIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const rateLimit = checkLoginRateLimit(email, requestIp);
  if (!rateLimit.allowed) {
    return {
      error: "Too many failed sign-in attempts. Please wait a few minutes and try again.",
    };
  }

  const shop = await db.shop.findFirstOrThrow();
  const authenticated = await authenticateStaffUser(shop.id, email, password);

  if (!authenticated) {
    recordFailedLoginAttempt(email, requestIp);
    // Deliberately generic — never reveal whether the email or the password was wrong.
    return { error: "Incorrect email or password." };
  }

  clearLoginAttempts(email, requestIp);
  return createUserSession(authenticated.id, redirectTo);
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Form method="post" className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-xl font-semibold">Just Shear Production Hub</h1>

        <input type="hidden" name="redirectTo" value={loaderData.redirectTo} />

        <label className="flex flex-col gap-1">
          <span className="text-sm">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Password</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>

        {actionData?.error ? (
          <p role="alert" className="text-sm text-red-600">
            {actionData.error}
          </p>
        ) : null}

        <button type="submit" className="rounded bg-gray-900 px-3 py-2 text-white">
          Sign in
        </button>
      </Form>
    </main>
  );
}
