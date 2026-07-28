import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REQUIRED_KEYS = [
  "DATABASE_URL",
  "SHOPIFY_SHOP_DOMAIN",
  "SHOPIFY_ADMIN_API_TOKEN",
  "SHOPIFY_API_SECRET_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "KLAVIYO_API_KEY",
] as const;

function validEnv() {
  return {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
    SHOPIFY_SHOP_DOMAIN: "test-store.myshopify.com",
    SHOPIFY_ADMIN_API_TOKEN: "shpat_test_secret_value",
    SHOPIFY_API_SECRET_KEY: "test_api_secret_value",
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-key-id",
    R2_SECRET_ACCESS_KEY: "test-secret",
    R2_BUCKET: "test-bucket",
    KLAVIYO_API_KEY: "pk_test",
    SESSION_SECRET: "a".repeat(32),
  };
}

describe("env.server", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("loads successfully when every required variable is present and valid", async () => {
    Object.assign(process.env, validEnv());
    const { env } = await import("~/lib/env.server");
    expect(env.SHOPIFY_SHOP_DOMAIN).toBe("test-store.myshopify.com");
  });

  it.each(REQUIRED_KEYS)("throws a clear error naming %s when it is missing", async (key) => {
    Object.assign(process.env, validEnv());
    Reflect.deleteProperty(process.env, key);

    await expect(import("~/lib/env.server")).rejects.toThrow(new RegExp(key));
  });

  it("defaults SHOPIFY_API_VERSION to the current stable version when not set", async () => {
    Object.assign(process.env, validEnv());
    Reflect.deleteProperty(process.env, "SHOPIFY_API_VERSION");

    const { env } = await import("~/lib/env.server");
    expect(env.SHOPIFY_API_VERSION).toBe("2026-07");
  });

  it("throws when SESSION_SECRET is shorter than 32 characters", async () => {
    Object.assign(process.env, validEnv(), { SESSION_SECRET: "too-short" });

    await expect(import("~/lib/env.server")).rejects.toThrow(/SESSION_SECRET/);
  });

  it("never includes variable values in the thrown error, only key names", async () => {
    const env = validEnv();
    Object.assign(process.env, env);
    delete process.env.SHOPIFY_ADMIN_API_TOKEN;

    let caught: unknown;
    try {
      await import("~/lib/env.server");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain(env.SHOPIFY_SHOP_DOMAIN);
    expect((caught as Error).message).not.toContain(env.R2_SECRET_ACCESS_KEY);
  });
});
