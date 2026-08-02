import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { StorageAdapter } from "~/adapters/storage/storage-adapter.server";
import { env } from "~/lib/env.server";

// Cloudflare R2 is S3-compatible — Cloudflare's own docs recommend the AWS
// SDK against R2's S3-compatible endpoint rather than a bespoke client. See
// ADR-0011 for why this replaces local-disk storage (ADR-0004) and what's
// been verified vs. not in this environment.
const client = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

async function objectExistsInternal(key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "NotFound") {
      return false;
    }
    throw error;
  }
}

async function streamToBuffer(stream: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export const r2StorageAdapter: StorageAdapter = {
  async putObject({ key, body }) {
    // A HeadObject-then-PutObject check, not an atomic conditional write —
    // the same documented, narrow race window this codebase already accepts
    // elsewhere (storage keys are always server-generated, never user
    // input, so a genuine collision is vanishingly unlikely in practice).
    if (await objectExistsInternal(key)) {
      throw new Error(`Refusing to overwrite an existing storage object: ${key}`);
    }
    await client.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body }));
  },
  async getObjectBuffer(key) {
    const result = await client.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    return streamToBuffer(result.Body);
  },
  async deleteObject(key) {
    await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  },
  async objectExists(key) {
    return objectExistsInternal(key);
  },
};
