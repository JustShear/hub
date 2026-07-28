import { describe, expect, it } from "vitest";
import { createUserSession, getStaffUserId } from "~/auth/staff-session.server";

function requestWithCookie(cookie: string | null) {
  const headers = new Headers();
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  return new Request("http://localhost/", { headers });
}

describe("staff-session.server", () => {
  it("round-trips a staff user id through the session cookie", async () => {
    const response = await createUserSession("staff_123", "/");
    const setCookie = response.headers.get("Set-Cookie");
    expect(setCookie).toBeTruthy();

    const cookieValue = setCookie?.split(";")[0] ?? "";
    const staffUserId = await getStaffUserId(requestWithCookie(cookieValue));

    expect(staffUserId).toBe("staff_123");
  });

  it("redirects to the given path after creating a session", async () => {
    const response = await createUserSession("staff_123", "/some/protected/path");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/some/protected/path");
  });

  it("returns undefined when there is no session cookie", async () => {
    const staffUserId = await getStaffUserId(requestWithCookie(null));
    expect(staffUserId).toBeUndefined();
  });

  it("returns undefined for a garbage cookie value", async () => {
    const staffUserId = await getStaffUserId(requestWithCookie("jsph_session=not-a-real-session"));
    expect(staffUserId).toBeUndefined();
  });
});
