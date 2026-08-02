// Manual/supplementary database backup — see docs/backup-and-restore.md for
// how this fits alongside Render's managed automatic backups, which are the
// primary recovery mechanism for a production deployment. This script exists
// for on-demand snapshots (before a risky migration, before a bulk data
// change) and local dev convenience, not as a replacement for those.
//
// Requires the Postgres client tools (`pg_dump`) on PATH — the same tools
// Render's own docs point to for manual exports.
//
// Usage:
//   npm run db:backup
//   npm run db:backup -- --out .backups/pre-migration.dump

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { env } from "../app/lib/env.server";

const DEFAULT_BACKUP_DIR = path.resolve(process.cwd(), ".backups");

function parseOutPath(argv: string[]): string {
  const outFlagIndex = argv.indexOf("--out");
  const outValue = outFlagIndex !== -1 ? argv[outFlagIndex + 1] : undefined;
  if (outValue) {
    return path.resolve(process.cwd(), outValue);
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(DEFAULT_BACKUP_DIR, `backup-${timestamp}.dump`);
}

async function main() {
  const outPath = parseOutPath(process.argv.slice(2));
  await mkdir(path.dirname(outPath), { recursive: true });

  console.log(`Backing up database to ${outPath} ...`);

  // Custom format (-Fc): compressed (zlib) and restorable with pg_restore's
  // selective/parallel options — a strict improvement over a plain gzip'd
  // SQL dump for the same "compressed dump" goal, at the cost of needing
  // pg_restore (not psql) to restore it. See restore-database.ts.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pg_dump",
      ["--format=custom", "--file", outPath, "--dbname", env.DATABASE_URL],
      { stdio: "inherit" },
    );
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "pg_dump was not found on PATH. Install the Postgres client tools " +
              "(e.g. `apt install postgresql-client` / the Postgres.app CLI tools / " +
              "`choco install postgresql`) and try again.",
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pg_dump exited with code ${code}`));
      }
    });
  });

  console.log(`Backup complete: ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
