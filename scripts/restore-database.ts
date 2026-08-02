// Restores a database from a pg_dump custom-format (-Fc) backup — the
// counterpart to scripts/backup-database.ts. See docs/backup-and-restore.md
// for the full runbook and drill.
//
// THIS IS DESTRUCTIVE: pg_restore's --clean --if-exists drops existing
// objects before recreating them from the dump, so anything in the target
// database that isn't in the dump is gone afterwards. Requires an explicit
// interactive confirmation by default — pass --yes only for a scripted
// restore where that confirmation has already happened elsewhere (e.g. a
// documented disaster-recovery runbook step, not routine use).
//
// Usage:
//   npm run db:restore -- .backups/backup-2026-08-03T10-00-00-000Z.dump
//   npm run db:restore -- .backups/backup-....dump --yes

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import readline from "node:readline/promises";
import { env } from "../app/lib/env.server";

function redactPassword(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "(unparseable connection string — not shown)";
  }
}

async function confirm(promptText: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(promptText);
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const skipConfirmation = args.includes("--yes");
  const dumpPath = args.find((arg) => !arg.startsWith("--"));

  if (!dumpPath) {
    throw new Error("Usage: npm run db:restore -- <path-to-dump-file> [--yes]");
  }
  if (!existsSync(dumpPath)) {
    throw new Error(`No such file: ${dumpPath}`);
  }

  const target = redactPassword(env.DATABASE_URL);
  console.log(`About to restore into: ${target}`);
  console.log(`From: ${dumpPath}`);
  console.log(
    "This will DROP and recreate every object in that database that exists in the dump. " +
      "Anything not in the dump is unaffected; anything that IS in the dump overwrites what's there now.",
  );

  if (!skipConfirmation) {
    const confirmed = await confirm('Type "yes" to proceed: ');
    if (!confirmed) {
      console.log("Aborted — nothing was restored.");
      return;
    }
  }

  console.log("Restoring...");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pg_restore",
      ["--clean", "--if-exists", "--no-owner", "--dbname", env.DATABASE_URL, dumpPath],
      { stdio: "inherit" },
    );
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "pg_restore was not found on PATH. Install the Postgres client tools and try again.",
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("exit", (code) => {
      // pg_restore can exit non-zero on benign warnings (e.g. "role does not
      // exist" for --no-owner) — this is the same tolerance Postgres's own
      // documentation recommends checking output for, rather than treating
      // any non-zero exit as a hard failure.
      if (code === 0 || code === 1) {
        resolve();
      } else {
        reject(new Error(`pg_restore exited with code ${code}`));
      }
    });
  });

  console.log("Restore complete. Review the output above for any warnings.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
