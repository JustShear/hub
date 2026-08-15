import { createCookieSessionStorage, redirect } from "react-router";
import type { Theme } from "@prisma/client";
import { db } from "~/lib/db.server";
import { env } from "~/lib/env.server";

const STAFF_USER_ID_KEY = "staffUserId";
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "jsph_session",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    secrets: [env.SESSION_SECRET],
    path: "/",
    maxAge: SEVEN_DAYS_SECONDS,
  },
});

export async function createUserSession(staffUserId: string, redirectTo: string) {
  const session = await sessionStorage.getSession();
  session.set(STAFF_USER_ID_KEY, staffUserId);
  return redirect(redirectTo, {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

export async function destroyUserSession(request: Request) {
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  return redirect("/login", {
    headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
  });
}

export async function getStaffUserId(request: Request): Promise<string | undefined> {
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  const value: unknown = session.get(STAFF_USER_ID_KEY);
  return typeof value === "string" ? value : undefined;
}

// Shape handed to app/auth/rbac.ts — permissions already flattened so
// hasPermission() never needs to touch the database itself.
export interface StaffUserWithPermissions {
  id: string;
  shopId: string;
  email: string;
  name: string;
  roleNames: string[];
  permissionKeys: Set<string>;
  theme: Theme;
}

async function loadStaffUserWithPermissions(
  staffUserId: string,
): Promise<StaffUserWithPermissions | null> {
  const staffUser = await db.staffUser.findUnique({
    where: { id: staffUserId },
    include: {
      roles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });

  if (!staffUser?.isActive) {
    return null;
  }

  const roleNames = staffUser.roles.map((staffRole) => staffRole.role.name);
  const permissionKeys = new Set(
    staffUser.roles.flatMap((staffRole) =>
      staffRole.role.permissions.map((rolePermission) => rolePermission.permission.key),
    ),
  );

  return {
    id: staffUser.id,
    shopId: staffUser.shopId,
    email: staffUser.email,
    name: staffUser.name,
    roleNames,
    permissionKeys,
    theme: staffUser.theme,
  };
}

export async function requireStaffUser(request: Request): Promise<StaffUserWithPermissions> {
  const staffUserId = await getStaffUserId(request);

  if (!staffUserId) {
    // Throwing a redirect Response is React Router's documented way to
    // short-circuit a loader — not an error, despite the lint rule's name.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirectToLogin(request);
  }

  const staffUser = await loadStaffUserWithPermissions(staffUserId);

  if (!staffUser) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirectToLogin(request);
  }

  return staffUser;
}

function redirectToLogin(request: Request) {
  const url = new URL(request.url);
  const searchParams = new URLSearchParams([["redirectTo", url.pathname + url.search]]);
  return redirect(`/login?${searchParams.toString()}`);
}
