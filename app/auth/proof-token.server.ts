import { createHash, randomBytes } from "node:crypto";
import { db } from "~/lib/db.server";
import { env } from "~/lib/env.server";

// 256 bits of entropy — unguessable by brute force, and never derived from
// any database identifier. This is the only place a raw token is ever
// generated; it is returned to the caller exactly once (to build the email
// link) and is never itself persisted, logged, or included in any response.
export function generateProofToken(): string {
  return randomBytes(32).toString("base64url");
}

// A raw token is verified by hashing the incoming value and looking up the
// hash via the database's own indexed equality match — the raw token is
// never compared byte-by-byte in application code (which is where a naive
// comparison could leak timing information), so there is no manual
// timingSafeEqual step needed here. This is the same reasoning already
// applied to stored file checksums elsewhere in the domain layer.
export function hashProofToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function computeProofTokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + env.PROOF_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

export interface ResolvedProofRequest {
  id: string;
  shopId: string;
  orderId: string;
  status: string;
  tokenExpiresAt: Date;
  revokedAt: Date | null;
}

export type ResolveProofTokenResult =
  | { outcome: "valid"; proofRequest: ResolvedProofRequest }
  | { outcome: "not_found" }
  | { outcome: "revoked"; proofRequest: ResolvedProofRequest }
  | { outcome: "expired"; proofRequest: ResolvedProofRequest };

// The single place that decides whether a customer-supplied token is usable
// right now. Never throws on an invalid/expired/revoked token — those are
// expected, common outcomes for a public endpoint, not exceptional ones.
export async function resolveProofRequestByToken(
  rawToken: string,
): Promise<ResolveProofTokenResult> {
  const tokenHash = hashProofToken(rawToken);

  const proofRequest = await db.proofRequest.findUnique({ where: { tokenHash } });

  if (!proofRequest) {
    return { outcome: "not_found" };
  }

  if (proofRequest.revokedAt) {
    return { outcome: "revoked", proofRequest };
  }

  if (proofRequest.tokenExpiresAt.getTime() < Date.now()) {
    return { outcome: "expired", proofRequest };
  }

  return { outcome: "valid", proofRequest };
}
