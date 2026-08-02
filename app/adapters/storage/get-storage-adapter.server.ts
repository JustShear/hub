import type { StorageAdapter } from "~/adapters/storage/storage-adapter.server";
import { localDiskStorageAdapter } from "~/adapters/storage/local-disk-storage.server";
import { r2StorageAdapter } from "~/adapters/storage/r2-storage.server";

// The one place that picks a concrete StorageAdapter — every caller depends
// on the interface (see storage-adapter.server.ts), never a provider
// directly, so this swap is the entire migration (ADR-0011). Local disk
// stays the adapter for development and the test suite (every existing test
// file's cleanup calls it directly, and there's no real R2 bucket to hit in
// this environment) — R2 is used whenever the app actually runs in
// production.
export const storageAdapter: StorageAdapter =
  process.env.NODE_ENV === "production" ? r2StorageAdapter : localDiskStorageAdapter;
