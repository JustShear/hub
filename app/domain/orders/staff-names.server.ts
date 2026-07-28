import { db } from "~/lib/db.server";

/** Batches every distinct staff id across a set of records into one query — avoids N+1 name lookups. */
export async function resolveStaffNames(
  staffIds: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const distinctIds = [...new Set(staffIds.filter((id): id is string => !!id))];
  if (distinctIds.length === 0) return new Map();
  const staff = await db.staffUser.findMany({
    where: { id: { in: distinctIds } },
    select: { id: true, name: true },
  });
  return new Map(staff.map((s) => [s.id, s.name]));
}
