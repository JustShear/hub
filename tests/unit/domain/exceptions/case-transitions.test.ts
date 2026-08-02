import { describe, expect, it } from "vitest";
import {
  canCancelCase,
  isTerminalCaseStatus,
  validateCaseStatusTransition,
} from "~/domain/exceptions/case-transitions";

describe("isTerminalCaseStatus", () => {
  it("treats RESOLVED and CANCELLED as terminal", () => {
    expect(isTerminalCaseStatus("RESOLVED")).toBe(true);
    expect(isTerminalCaseStatus("CANCELLED")).toBe(true);
  });

  it("treats OPEN, INVESTIGATING, and AWAITING_CUSTOMER as non-terminal", () => {
    expect(isTerminalCaseStatus("OPEN")).toBe(false);
    expect(isTerminalCaseStatus("INVESTIGATING")).toBe(false);
    expect(isTerminalCaseStatus("AWAITING_CUSTOMER")).toBe(false);
  });
});

describe("validateCaseStatusTransition", () => {
  it("allows OPEN to move to INVESTIGATING, AWAITING_CUSTOMER, or RESOLVED", () => {
    expect(validateCaseStatusTransition("OPEN", "INVESTIGATING").allowed).toBe(true);
    expect(validateCaseStatusTransition("OPEN", "AWAITING_CUSTOMER").allowed).toBe(true);
    expect(validateCaseStatusTransition("OPEN", "RESOLVED").allowed).toBe(true);
  });

  it("allows moving back and forth between INVESTIGATING and AWAITING_CUSTOMER", () => {
    expect(validateCaseStatusTransition("INVESTIGATING", "AWAITING_CUSTOMER").allowed).toBe(true);
    expect(validateCaseStatusTransition("AWAITING_CUSTOMER", "INVESTIGATING").allowed).toBe(true);
  });

  it("rejects an invalid jump", () => {
    const result = validateCaseStatusTransition("OPEN", "INVESTIGATING");
    expect(result.allowed).toBe(true);
    const invalid = validateCaseStatusTransition("RESOLVED", "INVESTIGATING" as never);
    expect(invalid.allowed).toBe(false);
    expect(invalid.reason).toContain("terminal status");
  });

  it("rejects any transition once a case is already RESOLVED or CANCELLED", () => {
    expect(validateCaseStatusTransition("RESOLVED", "OPEN" as never).allowed).toBe(false);
    expect(validateCaseStatusTransition("CANCELLED", "OPEN" as never).allowed).toBe(false);
  });
});

describe("canCancelCase", () => {
  it("allows cancelling from any non-terminal state", () => {
    expect(canCancelCase("OPEN").allowed).toBe(true);
    expect(canCancelCase("INVESTIGATING").allowed).toBe(true);
    expect(canCancelCase("AWAITING_CUSTOMER").allowed).toBe(true);
  });

  it("rejects cancelling an already-terminal case", () => {
    expect(canCancelCase("RESOLVED").allowed).toBe(false);
    expect(canCancelCase("CANCELLED").allowed).toBe(false);
  });
});
