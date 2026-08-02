import { z } from "zod";

// Fails closed: if a required variable is missing, the app must not boot.
// Only key NAMES are ever included in the thrown error — never values.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),

  SHOPIFY_SHOP_DOMAIN: z.string().min(1),
  SHOPIFY_ADMIN_API_TOKEN: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().min(1).default("2026-07"),
  // Webhook HMAC verification — a custom app's API secret key, not the Admin
  // API access token. Kept in env (not the Shop DB row) so signature
  // verification never depends on a database round-trip on the fast path.
  SHOPIFY_API_SECRET_KEY: z.string().min(1),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),

  KLAVIYO_API_KEY: z.string().min(1),

  // Milestone 12 — Starshipit freight labels. Both required (the API needs
  // both headers on every request); no default, since a placeholder value
  // would silently produce authentication failures indistinguishable from a
  // real outage rather than failing closed at boot.
  STARSHIPIT_API_KEY: z.string().min(1),
  STARSHIPIT_SUBSCRIPTION_KEY: z.string().min(1),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),

  // Milestone 09 — customer proof requests. Both configurable per the SRS
  // rather than hardcoded, with sensible documented defaults (see
  // docs/development.md "Proof requests (Milestone 09)").
  PROOF_TOKEN_EXPIRY_DAYS: z.coerce.number().int().positive().default(14),
  PROOF_REMINDER_DELAY_DAYS: z.coerce.number().int().positive().default(3),
  // The public origin used to build the customer proof-portal link
  // (`${APP_BASE_URL}/proof/:token`) embedded in the Klaviyo event's merge
  // fields. Defaults to the local dev server; every real deployment must
  // override this to its actual public origin.
  APP_BASE_URL: z.url().default("http://localhost:5173"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missingOrInvalid = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(
      `Missing or invalid environment variables: ${missingOrInvalid}. ` +
        `Copy .env.example to .env and fill in real values.`,
    );
  }

  return result.data;
}

export const env = loadEnv();
