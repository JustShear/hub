import { db } from "~/lib/db.server";
import { OPEN_STATUSES } from "~/domain/integrations/record-failure.server";

// Backs the app shell's integration-issue indicator badge — a plain count,
// never a fabricated one. Zero unresolved failures renders as zero, not as
// a hidden/absent badge that could be mistaken for "feature not working".
export async function countUnresolvedIntegrationFailures(shopId: string): Promise<number> {
  return db.integrationFailure.count({
    where: { shopId, status: { in: OPEN_STATUSES } },
  });
}
