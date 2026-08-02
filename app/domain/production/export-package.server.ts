import { createHash } from "node:crypto";
import { ZipFile } from "yazl";
import { storageAdapter } from "~/adapters/storage/get-storage-adapter.server";
import type { ExportManifest } from "~/domain/production/export-manifest";

export interface ExportPackageFileEntry {
  storageKey: string;
  archiveFilename: string;
}

export interface BuildExportPackageResult {
  buffer: Buffer;
  checksum: string;
}

/**
 * Builds the export ZIP package in memory: `manifest.json` plus every
 * production artwork file at its safe archive path. Never includes customer
 * mark-ups, raw Shopify payloads, internal notes, or secrets — the caller
 * is responsible for only passing production-artwork storage keys.
 */
export async function buildExportPackage(
  manifest: ExportManifest,
  files: ExportPackageFileEntry[],
): Promise<BuildExportPackageResult> {
  const zip = new ZipFile();
  const now = new Date();

  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), "manifest.json", {
    mtime: now,
    mode: 0o644,
  });

  for (const file of files) {
    const fileBuffer = await storageAdapter.getObjectBuffer(file.storageKey);
    zip.addBuffer(fileBuffer, file.archiveFilename, { mtime: now, mode: 0o644 });
  }

  const chunks: Buffer[] = [];
  const streamed = new Promise<void>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("end", () => {
      resolve();
    });
    zip.outputStream.on("error", (error: Error) => {
      reject(error);
    });
  });
  zip.end();
  await streamed;

  const buffer = Buffer.concat(chunks);
  const checksum = createHash("sha256").update(buffer).digest("hex");
  return { buffer, checksum };
}
