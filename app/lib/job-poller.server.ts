import { JobStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import { processShopifySyncJob } from "~/domain/orders/process-sync-job.server";
import { dispatchDueProofReminders } from "~/domain/proofs/dispatch-due-proof-reminders.server";

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 20;

declare global {
  var __jobPollerStarted: boolean | undefined;
}

// Safety net alongside the fire-and-forget kick each webhook route does:
// picks up anything PENDING or due for retry that never got processed (e.g.
// the process restarted mid-flight). Idempotent to call more than once —
// only the first call actually starts the interval. A single in-process
// poller is fine for Stage One's single-instance deployment; if this app
// ever runs multiple instances, this should move to a real distributed
// queue (see docs/development.md) since nothing here coordinates across
// processes.
export function startJobPoller(): void {
  if (global.__jobPollerStarted) {
    return;
  }
  global.__jobPollerStarted = true;

  setInterval(() => {
    void drainDueJobs().catch((error: unknown) => {
      console.error("Job poller iteration failed", error);
    });
    void dispatchDueProofReminders().catch((error: unknown) => {
      console.error("Proof reminder poller iteration failed", error);
    });
  }, POLL_INTERVAL_MS).unref();
}

// Exported so tests can trigger exactly one drain pass without waiting on
// the interval timer.
export async function drainDueJobs(): Promise<void> {
  const now = new Date();
  const dueJobs = await db.shopifySyncJob.findMany({
    where: {
      status: { in: [JobStatus.PENDING, JobStatus.FAILED] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    take: BATCH_SIZE,
    orderBy: { createdAt: "asc" },
  });

  for (const job of dueJobs) {
    await processShopifySyncJob(job.id);
  }
}
