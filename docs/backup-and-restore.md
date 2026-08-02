# Backup and restore (Milestone 16)

## The primary mechanism: Render's managed Postgres

This app's database is provisioned on Render's managed Postgres. On any paid plan, Render takes **automatic daily backups** and offers **point-in-time recovery** within the retention window for that plan tier — this is the primary, always-on recovery mechanism, requires no action from this app's code or scripts, and covers the vast majority of realistic recovery scenarios (accidental deletion discovered within days, a bad deploy, restoring to "yesterday morning"). See Render's own dashboard → Database → Backups tab to restore from one of these snapshots directly; that flow is entirely Render's own UI, not something this repository orchestrates.

The scripts described below are a **supplementary, manual mechanism** — for an on-demand snapshot immediately before a risky migration or bulk data change, or for local development convenience. They are not a replacement for Render's own backups, and they don't run on any automatic schedule themselves (no cron job is set up to invoke them — that would need its own dedicated scheduling infrastructure, out of scope here).

## File storage (Cloudflare R2): bucket versioning

Since Milestone 16 ([ADR-0011](decisions/0011-cloudflare-r2-migration.md)), all proof/artwork/export/freight-label files live in Cloudflare R2, not local disk. R2's equivalent of "backup" is **enabling bucket versioning** in the Cloudflare dashboard (R2 → your bucket → Settings → Object versioning). This is an infrastructure setting, not application code — there is no script in this repository for it, the same way there's no script for enabling Render's own backups. Turn it on once, when the production bucket is provisioned, so an accidental overwrite or delete of a proof file can be recovered from a prior version.

## Manual database backup/restore scripts

### `npm run db:backup`

```bash
npm run db:backup
npm run db:backup -- --out .backups/pre-migration.dump
```

Runs `pg_dump --format=custom` against `DATABASE_URL`, writing a single compressed dump file (pg_dump's custom format is zlib-compressed internally — this is a genuine improvement over a plain gzip'd SQL file for the same goal, since it also supports `pg_restore`'s selective-table and parallel-restore options). Defaults to `.backups/backup-<timestamp>.dump`; `.backups/` is gitignored — a database dump must never end up in source control.

**Requires the Postgres client tools (`pg_dump`) on the machine running the script.** This is the same requirement Render's own docs point to for manual exports. Install via your OS package manager (`apt install postgresql-client`, Homebrew's `postgresql` formula, `choco install postgresql`, etc.).

### `npm run db:restore`

```bash
npm run db:restore -- .backups/backup-2026-08-03T10-00-00-000Z.dump
```

Runs `pg_restore --clean --if-exists --no-owner` against `DATABASE_URL`, from the given dump file. **This is destructive** — `--clean --if-exists` drops every object in the target database that exists in the dump before recreating it from the dump's contents. The script prints the target connection (with the password redacted) and the dump path, explains what's about to happen, and requires typing `yes` at an interactive prompt before proceeding. Pass `--yes` to skip the prompt only for a scripted restore where confirmation has already happened elsewhere in a documented runbook step — never as routine practice.

## Restore drill (performed during this milestone)

Verified directly against the real local dev Postgres container (`docker-compose`'s `postgres:17` service) rather than just reading the pg_dump/pg_restore documentation:

1. Ran the exact `pg_dump --format=custom --file=... --dbname=...` command `backup-database.ts` builds, against the seeded local dev database. Produced a 347 KB dump.
2. Created a scratch database (`restore_smoketest`).
3. Ran the exact `pg_restore --clean --if-exists --no-owner --dbname=...` command `restore-database.ts` builds, restoring the dump into the scratch database. **Zero warnings.**
4. Compared row counts (`StaffUser`: 38 in both) and table counts (64 public tables in both) between the source database and the restored scratch database — identical.
5. Dropped the scratch database and deleted the dump file.

This confirms the exact flags both scripts use are correct against this schema and this Postgres version. It does **not** confirm the scripts' own Node.js child-process wiring end-to-end in this sandbox, because this development environment's host shell has no `pg_dump`/`pg_restore` on `PATH` (only the Postgres Docker container does) — `spawn("pg_dump", ...)` from the script itself was not exercised here. Anyone running these scripts for real needs the Postgres client tools installed locally (see above); that is a standard, expected operational prerequisite, not something this repository can install for them.

## What backup/restore does *not* cover

- **File storage (R2)**: covered by bucket versioning (above), not these scripts. A database restore alone does not bring back a deleted R2 object — the two need to be reasoned about together during any real recovery.
- **Shopify as source of truth for order data**: this app is fundamentally a downstream projection of Shopify's own order data (re-importable via `npm run import:order` or a fresh webhook backfill) — in a genuine disaster, Shopify itself remains the durable record for orders, even if this app's own database were unrecoverable.
- **Point-in-time granularity finer than a daily snapshot**: only Render's own managed point-in-time recovery offers this; the manual scripts here are single-snapshot, not continuous.
