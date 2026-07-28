import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Without an explicit teardown, RTL renders from earlier `it` blocks in the
// same file stay mounted — the config doesn't enable vitest's `globals`
// mode, so RTL's automatic afterEach-based cleanup never registers itself.
afterEach(() => {
  cleanup();
});
