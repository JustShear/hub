import type { DecorationMethod, ProofRequirementValue } from "@prisma/client";

// Pure readiness validation — no DB access, so both the UI (to show
// warnings inline) and the server action (to reject an invalid
// "mark ready to send" attempt) call the exact same logic. Server-side
// validation is authoritative; the UI copy is a courtesy, never the
// enforcement boundary.

export interface ProofGroupReadinessInput {
  name: string;
  placement: string | null;
  decorationMethod: DecorationMethod;
  requirementValue: ProofRequirementValue;
  linkedLineCount: number;
  currentVersion: {
    status: "DRAFT" | "READY_TO_SEND" | "SUPERSEDED" | "CANCELLED";
    hasStoredFile: boolean;
  } | null;
  hasOpenIntegrationFailure: boolean;
}

export interface ReadinessResult {
  ready: boolean;
  issues: string[];
}

/**
 * "Ready to send" means only that internal preparation is complete for a
 * later milestone to act on — nothing here sends anything to a customer.
 */
export function validateProofGroupReadiness(input: ProofGroupReadinessInput): ReadinessResult {
  const issues: string[] = [];

  if (input.requirementValue !== "REQUIRED") {
    issues.push(
      'Proof requirement must be set to "Proof required" before this group can be marked ready to send.',
    );
  }

  if (input.linkedLineCount === 0) {
    issues.push("At least one order line must be linked to this proof group.");
  }

  if (!input.currentVersion) {
    issues.push("This proof group has no proof version yet.");
  } else {
    if (input.currentVersion.status === "CANCELLED") {
      issues.push("The current proof version is cancelled.");
    } else if (input.currentVersion.status === "SUPERSEDED") {
      issues.push("The current proof version has already been superseded.");
    }
    if (!input.currentVersion.hasStoredFile) {
      issues.push("The current proof version has no successfully uploaded proof file.");
    }
  }

  if (!input.name.trim()) {
    issues.push("The proof group needs a name.");
  }

  // Placement isn't meaningful for an unprinted item — a documented
  // exception, not an oversight.
  if (input.decorationMethod !== "UNPRINTED" && !(input.placement ?? "").trim()) {
    issues.push("Placement is required for this decoration method.");
  }

  if (input.hasOpenIntegrationFailure) {
    issues.push("There is an unresolved upload or storage issue blocking this proof group.");
  }

  return { ready: issues.length === 0, issues };
}
