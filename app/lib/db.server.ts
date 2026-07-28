import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across Vite HMR reloads in dev so each edit
// doesn't open a fresh pool of Postgres connections.
declare global {
  var __prisma: PrismaClient | undefined;
}

export const db = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = db;
}
