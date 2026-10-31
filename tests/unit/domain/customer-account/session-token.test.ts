import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyCustomerSessionToken } from "~/domain/customer-account/session-token.server";

const SECRET = "app-client-secret";
const CLIENT_ID = "client-id-123";
const SHOP = "just-shear.myshopify.com";
const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;

function b64(value: unknown): string {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString(
    "base64url",
  );
}

function makeToken(
  payload: Record<string, unknown> = {},
  options: { secret?: string; header?: Record<string, unknown> } = {},
): string {
  const header = b64(options.header ?? { alg: "HS256", typ: "JWT" });
  const body = b64({
    iss: "https://shopify.com/1/account",
    dest: `https://${SHOP}`,
    aud: CLIENT_ID,
    sub: "gid://shopify/Customer/8123",
    exp: NOW_S + 300,
    nbf: NOW_S - 5,
    iat: NOW_S - 5,
    jti: "abc",
    ...payload,
  });
  const signature = createHmac("sha256", options.secret ?? SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verify(token: string | null, overrides: { nowMs?: number } = {}) {
  return verifyCustomerSessionToken({
    authorizationHeader: token === null ? null : `Bearer ${token}`,
    clientId: CLIENT_ID,
    secret: SECRET,
    shopDomain: SHOP,
    nowMs: NOW_MS,
    ...overrides,
  });
}

describe("verifyCustomerSessionToken", () => {
  it("accepts a valid token and returns the customer from the signed sub claim", () => {
    expect(verify(makeToken())).toEqual({
      ok: true,
      customerId: "8123",
      customerGid: "gid://shopify/Customer/8123",
    });
  });

  it("accepts a dest given as a bare host and an aud given as a list", () => {
    expect(verify(makeToken({ dest: SHOP.toUpperCase(), aud: ["other", CLIENT_ID] })).ok).toBe(
      true,
    );
  });

  it.each([null, "", "Basic abc", "Bearer", "Bearer a.b", "Bearer a.b.c.d"])(
    "rejects a missing or malformed header: %j",
    (header) => {
      const result = verifyCustomerSessionToken({
        authorizationHeader: header,
        clientId: CLIENT_ID,
        secret: SECRET,
        shopDomain: SHOP,
        nowMs: NOW_MS,
      });
      expect(result.ok).toBe(false);
    },
  );

  it("rejects a token signed with the wrong secret", () => {
    expect(verify(makeToken({}, { secret: "someone-elses-secret" }))).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a payload that was altered after signing", () => {
    const [header, , signature] = makeToken().split(".");
    const forged = b64({
      dest: `https://${SHOP}`,
      aud: CLIENT_ID,
      sub: "gid://shopify/Customer/999",
      exp: NOW_S + 300,
    });
    expect(verify(`${header}.${forged}.${signature}`)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects alg=none and any non-HS256 algorithm, even with a valid-looking body", () => {
    const body = b64({
      dest: `https://${SHOP}`,
      aud: CLIENT_ID,
      sub: "gid://shopify/Customer/1",
      exp: NOW_S + 300,
    });
    expect(verify(`${b64({ alg: "none" })}.${body}.`).ok).toBe(false);
    expect(verify(makeToken({}, { header: { alg: "none" } })).ok).toBe(false);
    expect(verify(makeToken({}, { header: { alg: "HS512" } })).ok).toBe(false);
    expect(verify(makeToken({}, { header: { alg: "RS256" } })).ok).toBe(false);
  });

  it("rejects an expired token (beyond the small clock-skew leeway) but tolerates a few seconds", () => {
    expect(verify(makeToken({ exp: NOW_S - 60 }))).toEqual({ ok: false, reason: "expired" });
    expect(verify(makeToken({ exp: NOW_S - 5 })).ok).toBe(true);
    expect(verify(makeToken({ exp: undefined }))).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token that is not valid yet", () => {
    expect(verify(makeToken({ nbf: NOW_S + 120 }))).toEqual({
      ok: false,
      reason: "not_yet_valid",
    });
  });

  it("rejects a token issued for a different app", () => {
    expect(verify(makeToken({ aud: "another-app" }))).toEqual({
      ok: false,
      reason: "wrong_audience",
    });
    expect(verify(makeToken({ aud: undefined }))).toEqual({
      ok: false,
      reason: "wrong_audience",
    });
  });

  it("rejects a token from a different shop", () => {
    expect(verify(makeToken({ dest: "https://other-shop.myshopify.com" }))).toEqual({
      ok: false,
      reason: "wrong_shop",
    });
    expect(verify(makeToken({ dest: undefined }))).toEqual({ ok: false, reason: "wrong_shop" });
  });

  it("rejects a token with no signed-in customer, or a sub that is not a customer gid", () => {
    expect(verify(makeToken({ sub: undefined }))).toEqual({ ok: false, reason: "no_customer" });
    expect(verify(makeToken({ sub: "gid://shopify/Order/1" }))).toEqual({
      ok: false,
      reason: "no_customer",
    });
    expect(verify(makeToken({ sub: "gid://shopify/Customer/12; DROP" }))).toEqual({
      ok: false,
      reason: "no_customer",
    });
  });

  it("never throws on garbage input", () => {
    for (const garbage of ["....", "a.b.c", "%%%.%%%.%%%", "e30.e30.e30", b64("x") + ".x.y"]) {
      expect(() => verify(garbage)).not.toThrow();
      expect(verify(garbage).ok).toBe(false);
    }
  });
});
