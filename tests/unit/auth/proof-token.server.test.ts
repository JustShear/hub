import { describe, expect, it } from "vitest";
import {
  computeProofTokenExpiry,
  generateProofToken,
  hashProofToken,
} from "~/auth/proof-token.server";

describe("proof-token.server", () => {
  it("generates a high-entropy, URL-safe token", () => {
    const token = generateProofToken();

    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a different token on every call", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateProofToken()));

    expect(tokens.size).toBe(20);
  });

  it("hashes deterministically — the same token always hashes the same way", () => {
    const token = generateProofToken();

    expect(hashProofToken(token)).toBe(hashProofToken(token));
  });

  it("produces different hashes for different tokens", () => {
    const a = generateProofToken();
    const b = generateProofToken();

    expect(hashProofToken(a)).not.toBe(hashProofToken(b));
  });

  it("never returns the raw token as its own hash", () => {
    const token = generateProofToken();

    expect(hashProofToken(token)).not.toBe(token);
  });

  it("produces a 64-character hex sha256 digest", () => {
    const hash = hashProofToken(generateProofToken());

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("computes an expiry PROOF_TOKEN_EXPIRY_DAYS in the future", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const expiry = computeProofTokenExpiry(from);

    const expectedDays = (expiry.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    expect(expectedDays).toBe(14);
  });
});
