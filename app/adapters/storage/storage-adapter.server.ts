// Provider-agnostic object-storage interface (see ADR-0004). Every caller
// depends on this interface, never on a concrete provider, so swapping the
// local-disk implementation for real Cloudflare R2 (Milestone 11 per the
// SRS) is a one-file change with no calling-code updates.
export interface StorageAdapter {
  /** Rejects if an object already exists at `key` — never overwrites. */
  putObject(params: { key: string; body: Buffer }): Promise<void>;
  getObjectBuffer(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
}
