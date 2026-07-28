import { expect, test } from "@playwright/test";

// Read from .env via playwright.config.ts's process.loadEnvFile() — never a
// hardcoded password. Run `npm run db:seed` with DEV_ADMIN_PASSWORD set
// before running these tests.
function requireAdminPassword(): string {
  const password = process.env.DEV_ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      "DEV_ADMIN_PASSWORD is not set. Set it in .env and run `npm run db:seed` " +
        "before running e2e tests, so the seeded admin account has a password these tests can sign in with.",
    );
  }
  return password;
}

test("redirects to /login when signed out, then allows sign-in and sign-out", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill("admin@justshear.com");
  await page.getByLabel("Password").fill(requireAdminPassword());
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("http://localhost:5173/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome, Administrator" })).toBeVisible();

  await page.getByRole("button", { name: "Account menu for Administrator" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/login/);

  // Confirm the session really was destroyed, not just a client-side redirect.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("shows a generic error for incorrect credentials", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill("admin@justshear.com");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("alert")).toHaveText("Incorrect email or password.");
  await expect(page).toHaveURL(/\/login/);
});
