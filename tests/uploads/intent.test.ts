import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterAll, describe, expect, it } from "vitest";

import { createStorage } from "../../src/factory";
import {
  defineUploadIntent,
  saveUploadIntent,
  type SavedUpload,
  type UploadFileInput,
  type UploadIntent,
  type UploadOptions,
  type UploadResult,
} from "../../src/uploads";
import type { Storage } from "../../src/core/types";

interface RecordedUpload {
  path: string;
  body: unknown;
  options: UploadOptions;
}

function stubStorage() {
  const uploads: RecordedUpload[] = [];
  const storage = {
    type: "local",
    upload: async (
      key: string,
      body: UploadFileInput["body"],
      options: UploadOptions,
    ): Promise<UploadResult> => {
      uploads.push({ path: key, body, options });
      return { path: key, provider: "local", etag: "etag-1" };
    },
  } as unknown as Storage<"local">;
  return { storage, uploads };
}

describe("saveUploadIntent", () => {
  it("normalizes a web File: name, type and size feed the key and metadata", async () => {
    const { storage, uploads } = stubStorage();
    const file = new File(["hello"], "Photo.JPG", { type: "image/jpeg" });

    const saved = await saveUploadIntent(storage, { source: file, directory: "uploads" });

    expect(saved.key).toMatch(/^uploads\/[0-9a-f-]{36}\.jpg$/);
    expect(saved.originalName).toBe("Photo.JPG");
    expect(saved.mimeType).toBe("image/jpeg");
    expect(uploads[0]!.options.contentType).toBe("image/jpeg");
    expect(uploads[0]!.options.metadata).toMatchObject({
      originalname: "Photo.JPG",
      mimetype: "image/jpeg",
    });
  });

  it("accepts middleware-shaped sources and key resolvers", async () => {
    const { storage, uploads } = stubStorage();
    const intent: UploadIntent = {
      source: {
        body: Readable.from("x"),
        originalName: "report.pdf",
        fieldname: "attachment",
        size: 1,
      },
      key: (file) => `docs/${file.originalName}`,
    };

    const saved = await saveUploadIntent(storage, intent);

    expect(saved.key).toBe("docs/report.pdf");
    expect(uploads[0]!.options.contentLength).toBe(1);
    expect(uploads[0]!.options.metadata).toMatchObject({ fieldname: "attachment" });
  });

  it("accepts bare bytes and applies overrides", async () => {
    const { storage, uploads } = stubStorage();

    await saveUploadIntent(storage, {
      source: Buffer.from("hello"),
      directory: "notes",
      key: "notes/known-key.txt",
      contentType: "text/plain",
      metadata: { tenantId: "t1" },
      overwrite: false,
    });

    expect(uploads[0]!.path).toBe("notes/known-key.txt");
    expect(uploads[0]!.options.contentType).toBe("text/plain");
    expect(uploads[0]!.options.metadata).toEqual({ tenantId: "t1" });
    expect(uploads[0]!.options.overwrite).toBe(false);
  });

  it("defineUploadIntent returns the intent unchanged for typed literals", () => {
    const intent = defineUploadIntent({ source: "hello", directory: "notes" });
    expect(intent.source).toBe("hello");
    expect(intent.directory).toBe("notes");
    // The helper only pins the storage type: `UploadIntent<"s3">` rejects
    // foreign `native` fields at compile time.
    const typed: UploadIntent<"s3"> = defineUploadIntent<"s3">({
      source: Buffer.from("x"),
      native: { StorageClass: "INTELLIGENT_TIERING" },
    });
    expect(typed.native).toBeDefined();
  });

  it("runs against a real local storage end to end", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "storagekit-intent-"));
    afterAll(() => rm(dir, { recursive: true, force: true }));

    const storage = await createStorage({ type: "local", root: dir });
    const intent: UploadIntent<"local"> = defineUploadIntent<"local">({
      source: new File(["intent body"], "note.txt", { type: "text/plain" }),
      directory: "notes",
    });
    const saved: SavedUpload<"local"> = await saveUploadIntent(storage, intent);

    expect(saved.key).toMatch(/^notes\//);
    expect(await readFile(path.join(dir, saved.key), "utf8")).toBe("intent body");
  });
});
