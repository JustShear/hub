import { Prisma } from "@prisma/client";

/** True for a unique-constraint violation (Postgres error code P2002) — the standard signal of a benign creation race. */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
