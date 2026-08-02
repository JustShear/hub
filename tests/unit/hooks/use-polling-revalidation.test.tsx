import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { shouldPollTick, usePollingRevalidation } from "~/hooks/use-polling-revalidation";

describe("shouldPollTick", () => {
  it("ticks when idle and the tab is visible", () => {
    expect(shouldPollTick("idle", "visible")).toBe(true);
  });

  it("does not tick while a revalidation or navigation is already in flight", () => {
    expect(shouldPollTick("loading", "visible")).toBe(false);
    expect(shouldPollTick("submitting", "visible")).toBe(false);
  });

  it("does not tick while the tab is hidden, even if idle", () => {
    expect(shouldPollTick("idle", "hidden")).toBe(false);
  });
});

function TestComponent() {
  usePollingRevalidation(1000);
  return null;
}

describe("usePollingRevalidation", () => {
  it("mounts and unmounts cleanly inside a real router context", () => {
    const Stub = createRoutesStub([{ path: "/test", Component: TestComponent }]);
    const { unmount } = render(<Stub initialEntries={["/test"]} />);
    expect(() => {
      unmount();
    }).not.toThrow();
  });
});
