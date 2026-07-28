import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// vitest always runs with the project root as cwd.
const REPO_ROOT = `${process.cwd()}/`;

// A committed, well-known password would let anyone with repo access sign
// into any deployment seeded from it — guards against that regressing.
describe("seed credentials", () => {
  it("prisma/seed.ts never hardcodes a usable default password", () => {
    const contents = readFileSync(`${REPO_ROOT}prisma/seed.ts`, "utf-8");
    expect(contents).not.toMatch(/change-me-on-first-login/);
  });

  it("the e2e auth spec reads the admin password from the environment, not a literal", () => {
    const contents = readFileSync(`${REPO_ROOT}tests/e2e/auth.spec.ts`, "utf-8");
    expect(contents).not.toMatch(/change-me-on-first-login/);
    expect(contents).toContain("process.env.DEV_ADMIN_PASSWORD");
  });
});
