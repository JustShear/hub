import { describe, expect, it } from "vitest";
import { derivePickJobStatus } from "~/domain/warehouse/pick-job-state";

describe("derivePickJobStatus", () => {
  it("stays QUEUED when nothing has been touched", () => {
    expect(derivePickJobStatus([{ status: "PENDING" }, { status: "PENDING" }], "QUEUED")).toBe(
      "QUEUED",
    );
  });

  it("becomes IN_PROGRESS once anything has started", () => {
    expect(derivePickJobStatus([{ status: "IN_PROGRESS" }, { status: "PENDING" }], "QUEUED")).toBe(
      "IN_PROGRESS",
    );
  });

  it("stays IN_PROGRESS even once every item reaches a terminal state — handover is always explicit", () => {
    expect(derivePickJobStatus([{ status: "PICKED" }, { status: "SHORT" }], "IN_PROGRESS")).toBe(
      "IN_PROGRESS",
    );
  });

  it("never moves a HANDED_OVER job away from that terminal status", () => {
    expect(derivePickJobStatus([{ status: "PICKED" }], "HANDED_OVER")).toBe("HANDED_OVER");
  });

  it("never moves a CANCELLED job away from that terminal status", () => {
    expect(derivePickJobStatus([{ status: "PENDING" }], "CANCELLED")).toBe("CANCELLED");
  });
});
