import { describe, expect, it } from "vitest";
import {
  summarizeProofGroupsForBoard,
  type BoardProofGroupInput,
} from "~/domain/proofs/board-summary";

function group(overrides: Partial<BoardProofGroupInput> = {}): BoardProofGroupInput {
  return { status: "NOT_STARTED", hasOpenIntegrationFailure: false, ...overrides };
}

describe("summarizeProofGroupsForBoard", () => {
  it("excludes cancelled groups from the active count", () => {
    const result = summarizeProofGroupsForBoard([group(), group({ status: "CANCELLED" })]);
    expect(result.activeGroupCount).toBe(1);
  });

  it("counts ready, no-proof-required, and blocked groups independently", () => {
    const result = summarizeProofGroupsForBoard([
      group({ status: "READY_TO_SEND" }),
      group({ status: "NO_PROOF_REQUIRED" }),
      group({ status: "DRAFT_IN_PROGRESS", hasOpenIntegrationFailure: true }),
    ]);
    expect(result).toMatchObject({
      activeGroupCount: 3,
      readyCount: 1,
      noProofRequiredCount: 1,
      blockedCount: 1,
    });
  });

  it("counts a group requiring work only when it's neither ready, no-proof-required, nor blocked", () => {
    const result = summarizeProofGroupsForBoard([group({ status: "DRAFT_IN_PROGRESS" })]);
    expect(result.requiringWorkCount).toBe(1);
    expect(result.readyCount).toBe(0);
  });

  it("returns all zeroes for an empty list", () => {
    expect(summarizeProofGroupsForBoard([])).toMatchObject({
      activeGroupCount: 0,
      readyCount: 0,
      requiringWorkCount: 0,
      noProofRequiredCount: 0,
      blockedCount: 0,
    });
  });
});
