import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class FakeCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class FakeS3Client {
    send = sendMock;
  }
  return {
    S3Client: FakeS3Client,
    PutObjectCommand: class extends FakeCommand {},
    GetObjectCommand: class extends FakeCommand {},
    DeleteObjectCommand: class extends FakeCommand {},
    HeadObjectCommand: class extends FakeCommand {},
  };
});

const { r2StorageAdapter } = await import("~/adapters/storage/r2-storage.server");

// Exercises r2-storage.server.ts against a mocked S3 client — there is no
// real Cloudflare R2 bucket to hit in this environment (mirrors ADR-0008's
// own "not confirmed against a real sandbox" precedent for Starshipit). This
// verifies the adapter satisfies the StorageAdapter contract correctly
// against the mocked AWS SDK surface, not that a real bucket round-trips.
describe("r2StorageAdapter (unit, mocked S3 client)", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("putObject rejects when the key already exists", async () => {
    sendMock.mockResolvedValueOnce({}); // HeadObjectCommand succeeds -> exists

    await expect(
      r2StorageAdapter.putObject({ key: "some/key.png", body: Buffer.from("x") }),
    ).rejects.toThrow(/Refusing to overwrite/);

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("putObject writes the object when the key doesn't exist yet", async () => {
    const notFound = Object.assign(new Error("not found"), { name: "NotFound" });
    sendMock.mockRejectedValueOnce(notFound); // HeadObjectCommand -> doesn't exist
    sendMock.mockResolvedValueOnce({}); // PutObjectCommand

    await r2StorageAdapter.putObject({ key: "some/key.png", body: Buffer.from("x") });

    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("putObject re-throws an unexpected HeadObject error rather than treating it as absent", async () => {
    sendMock.mockRejectedValueOnce(new Error("network failure"));

    await expect(
      r2StorageAdapter.putObject({ key: "some/key.png", body: Buffer.from("x") }),
    ).rejects.toThrow("network failure");
  });

  it("getObjectBuffer converts the returned stream to a Buffer", async () => {
    const body = Readable.from([Buffer.from("hello "), Buffer.from("world")]);
    sendMock.mockResolvedValueOnce({ Body: body });

    const result = await r2StorageAdapter.getObjectBuffer("some/key.png");

    expect(result.toString()).toBe("hello world");
  });

  it("deleteObject and objectExists call through to the client", async () => {
    sendMock.mockResolvedValueOnce({});
    await r2StorageAdapter.deleteObject("some/key.png");
    expect(sendMock).toHaveBeenCalledTimes(1);

    sendMock.mockResolvedValueOnce({});
    await expect(r2StorageAdapter.objectExists("some/key.png")).resolves.toBe(true);

    const notFound = Object.assign(new Error("not found"), { name: "NotFound" });
    sendMock.mockRejectedValueOnce(notFound);
    await expect(r2StorageAdapter.objectExists("some/key.png")).resolves.toBe(false);
  });
});
