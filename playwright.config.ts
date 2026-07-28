import { defineConfig } from "@playwright/test";

// Node's built-in .env loader — makes DEV_ADMIN_PASSWORD (and anything else
// in .env) available to this config and to the dev server it spawns, with no
// extra dependency. Safe to skip silently if .env doesn't exist locally.
try {
  process.loadEnvFile();
} catch {
  // No .env file present — fine, env vars may be set another way.
}

export default defineConfig({
  testDir: "./tests/e2e",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:5173",
  },
});
