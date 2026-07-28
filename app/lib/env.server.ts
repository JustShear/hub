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

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
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
