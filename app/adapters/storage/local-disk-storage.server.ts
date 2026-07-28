import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "~/adapters/storage/storage-adapter.server";

// Interim concrete adapter (see ADR-0004) — real Cloudflare R2 storage is
// Milestone 11 per the SRS's own sequencing. Storage keys are always
// generated server-side (see create-proof-version.server.ts's
// generateProofAssetStorageKey), never derived from user input, so path
// traversal isn't reachable through normal use — the containment check
// below is defense in depth, not the primary guard.
const STORAGE_ROOT = path.resolve(process.cwd(), process.env.PROOF_STORAGE_DIR ?? ".storage");

function resolveObjectPath(key: string): string {
  const resolved = path.resolve(STORAGE_ROOT, key);
  if (resolved !== STORAGE_ROOT && !resolved.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error("Refusing to resolve a storage key outside the storage root.");
  }
  return resolved;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export const localDiskStorageAdapter: StorageAdapter = {
  async putObject({ key, body }) {
    const filePath = resolveObjectPath(key);
    if (await pathExists(filePath)) {
      throw new Error(`Refusing to overwrite an existing storage object: ${key}`);
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
  },
  async getObjectBuffer(key) {
    return readFile(resolveObjectPath(key));
  },
  async deleteObject(key) {
    await rm(resolveObjectPath(key), { force: true });
  },
  async objectExists(key) {
    return pathExists(resolveObjectPath(key));
  },
};
