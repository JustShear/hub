import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "~/lib/env.server";

type TxClient = Prisma.TransactionClient | PrismaClient;

/**
 * Called once, inside the same transaction as sendProofRequest — the
 * @@unique([proofRequestId]) constraint on ProofReminder is what actually
 * guarantees "at most one reminder per proof request," not application
 * logic alone.
 */
export async function scheduleProofReminder(tx: TxClient, proofRequestId: string): Promise<void> {
  const scheduledFor = new Date(Date.now() + env.PROOF_REMINDER_DELAY_DAYS * 24 * 60 * 60 * 1000);
  await tx.proofReminder.create({ data: { proofRequestId, scheduledFor } });
}
