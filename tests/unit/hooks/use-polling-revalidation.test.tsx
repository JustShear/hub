import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
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

describe("usePollingRevalidation enabled flag", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderWithLoaderCounter(enabled: boolean) {
    let loaderCalls = 0;
    function Poller() {
      usePollingRevalidation(1000, enabled);
      return null;
    }
    const Stub = createRoutesStub([
      {
        path: "/test",
        Component: Poller,
        loader() {
          loaderCalls += 1;
          return null;
        },
      },
    ]);
    render(<Stub initialEntries={["/test"]} />);
    return () => loaderCalls;
  }

  it("re-runs the route's loaders on each interval while enabled", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getCalls = renderWithLoaderCounter(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const afterMount = getCalls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(getCalls()).toBeGreaterThan(afterMount);
  });

  it("never polls while disabled (e.g. an order drawer is open)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getCalls = renderWithLoaderCounter(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const afterMount = getCalls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getCalls()).toBe(afterMount);
  });
});
