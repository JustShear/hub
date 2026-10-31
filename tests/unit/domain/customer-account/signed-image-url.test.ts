import { describe, expect, it } from "vitest";
import {
  buildProofImageUrl,
  PROOF_IMAGE_URL_TTL_SECONDS,
  verifyProofImageLink,
} from "~/domain/customer-account/signed-image-url.server";

const SECRET = "app-client-secret";
const NOW_MS = 1_800_000_000_000;

function build(overrides: Partial<Parameters<typeof buildProofImageUrl>[0]> = {}) {
  return new URL(
    buildProofImageUrl({
      baseUrl: "https://hub.example.com/",
      secret: SECRET,
      assetId: "asset_1",
      customerId: "8123",
      nowMs: NOW_MS,
      ...overrides,
    }),
  );
}

function verify(url: URL, overrides: { assetId?: string; nowMs?: number; secret?: string } = {}) {
  return verifyProofImageLink({
    assetId: overrides.assetId ?? "asset_1",
    searchParams: url.searchParams,
    secret: overrides.secret ?? SECRET,
    nowMs: overrides.nowMs ?? NOW_MS,
  });
}

describe("proof image links", () => {
  it("builds a link on the Hub's own origin that verifies for its customer", () => {
    const url = build();
    expect(url.origin).toBe("https://hub.example.com");
    expect(url.pathname).toBe("/api/customer-account/proof-image/asset_1");
    expect(verify(url)).toEqual({ ok: true, customerId: "8123" });
  });

  it("stops working after it expires", () => {
    const url = build();
    const later = NOW_MS + (PROOF_IMAGE_URL_TTL_SECONDS + 5) * 1000;
    expect(verify(url, { nowMs: later })).toEqual({ ok: false, reason: "expired" });
    expect(verify(url, { nowMs: NOW_MS + 60_000 }).ok).toBe(true);
  });

  it("cannot be reused for a different file", () => {
    expect(verify(build(), { assetId: "asset_2" })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("cannot be re-pointed at a different customer", () => {
    const url = build();
    url.searchParams.set("cid", "9999");
    expect(verify(url)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("cannot have its expiry extended", () => {
    const url = build();
    url.searchParams.set("exp", String(Number(url.searchParams.get("exp")) + 86_400));
    expect(verify(url)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("is rejected when signed with a different secret", () => {
    expect(verify(build({ secret: "other-secret" }))).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it.each([
    ["cid", "abc"],
    ["exp", ""],
    ["sig", "short"],
    ["sig", "Z".repeat(64)],
  ])("rejects a malformed %s=%j without throwing", (key, value) => {
    const url = build();
    url.searchParams.set(key, value);
    expect(verify(url)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a link with no parameters at all", () => {
    expect(
      verifyProofImageLink({
        assetId: "asset_1",
        searchParams: new URLSearchParams(),
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: "malformed" });
  });
});
