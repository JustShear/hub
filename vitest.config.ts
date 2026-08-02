import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/unit/setup.ts"],
    env: {
      // Dummy-but-valid values so importing env.server.ts doesn't throw during
      // test collection. DATABASE_URL points at the real local dev Postgres
      // (docker-compose) since integration tests need an actual connection;
      // everything else here is never a real credential.
      DATABASE_URL:
        "postgresql://just_shear:just_shear_dev@localhost:5432/just_shear_production_hub",
      SHOPIFY_SHOP_DOMAIN: "test-store.myshopify.com",
      SHOPIFY_ADMIN_API_TOKEN: "shpat_test",
      SHOPIFY_API_SECRET_KEY: "test_webhook_secret_for_hmac_verification",
      R2_ACCOUNT_ID: "test-account",
      R2_ACCESS_KEY_ID: "test-key-id",
      R2_SECRET_ACCESS_KEY: "test-secret",
      R2_BUCKET: "test-bucket",
      KLAVIYO_API_KEY: "pk_test",
      STARSHIPIT_API_KEY: "test-starshipit-key",
      STARSHIPIT_SUBSCRIPTION_KEY: "test-starshipit-subscription-key",
      SESSION_SECRET: "test-session-secret-at-least-32-characters-long",
    },
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
});
