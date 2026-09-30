# End-to-end examples

Complete, runnable applications built with StorageKit. Each example is a
single file — install, paste, run.

## 1. Upload service: multer engine, validation, serving back (Express)

```sh
mkdir uploads-service && cd uploads-service && npm init -y
npm install @mohamedhabibwork/storagekit express multer
node server.mjs
```

```ts
// server.mjs — node >= 20. Local driver: no provider SDK needed.
import express from "express";
import multer from "multer";
import { createStorage } from "@mohamedhabibwork/storagekit/local";
import { createMulterStorage } from "@mohamedhabibwork/storagekit/adapters/express";

const app = express();

const storage = await createStorage({
  type: "local",
  root: "./data",
  baseUrl: "/files", // powers getUrl() for serving
});

const upload = multer({
  storage: createMulterStorage(storage, { directory: "uploads" }),
  limits: { fileSize: 10 * 1024 * 1024 }, // validate size before the engine runs
});

app.post("/upload", upload.single("file"), (req, res) => {
  res.status(201).json({
    key: req.file!.key, // stored object key
    etag: req.file!.etag,
    url: req.file!.storagekit?.result.url,
  });
});

app.get("/files/:key", async (req, res) => {
  const download = await storage.download(`uploads/${req.params.key}`);
  res.setHeader("content-type", download.contentType ?? "application/octet-stream");
  download.stream.pipe(res);
});

app.delete("/files/:key", async (req, res) => {
  await storage.delete(`uploads/${req.params.key}`); // idempotent
  res.status(204).end();
});

app.listen(3000, () => console.log("POST /upload (multipart field: file)"));
```

```sh
curl -F file=@photo.jpg localhost:3000/upload
curl -O localhost:3000/files/<key-from-response>
```

The engine streams the request straight into storage (no scratch files), and a
request abort deletes the stored object. Swap the driver config for
`{ type: "s3", bucket, region }` (plus `npm i @aws-sdk/client-s3
@aws-sdk/lib-storage @aws-sdk/s3-request-presigner`) and the same routes run
against S3 — see [uploads.md](uploads.md) for the NestJS, Koa, Fastify, Hono,
and Elysia variants.

## 2. Backup pipeline: local → S3, streaming with progress

```sh
npm install @mohamedhabibwork/storagekit @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner
node backup.mjs
```

```ts
// backup.mjs
import { createStorage } from "@mohamedhabibwork/storagekit/local";
import { createS3Storage } from "@mohamedhabibwork/storagekit/s3";
import { copyBetween } from "@mohamedhabibwork/storagekit";

const local = await createStorage({ type: "local", root: "./data" });
const s3 = await createS3Storage({ type: "s3", bucket: "my-backups", region: "eu-central-1" });

for await (const file of local.iterate("uploads/")) {
  await copyBetween(local, file.path, s3, `daily/${file.path}`, {
    concurrency: 4,
    onProgress: (bytes) => process.stdout.write(`\r${file.path}: ${bytes} bytes`),
  });
  console.log(" done");
}
```

`copyBetween` streams through the process (never fully buffered) and works
between any two providers — local, S3, MinIO, Azure, GCS, Oracle, RustFS.

## 3. Describe uploads once, run them anywhere (intents)

An intent is a plain object: where the bytes come from, how to store them.
Because it is re-runnable and driver-agnostic, the same intent runs against
local storage in dev and S3 in prod — and retries are just re-runs.

```sh
npm install @mohamedhabibwork/storagekit @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner
```

```ts
// intents.mjs — describe WHAT to store; the caller decides WHERE and WHEN.
import { defineUploadIntent } from "@mohamedhabibwork/storagekit/uploads";

export const avatarIntent = (file, tenantId) =>
  defineUploadIntent({
    source: file, // web File, middleware file, or bare bytes
    directory: `tenants/${tenantId}/avatars`,
    overwrite: false,
    metadata: false, // no client names in metadata for avatars
  });
```

```ts
// service.mjs
import { createStorage } from "@mohamedhabibwork/storagekit/local";
import { saveUploadIntent, StorageNetworkError } from "@mohamedhabibwork/storagekit";
import { avatarIntent } from "./intents.mjs";

// Dev: local disk. Production: createStorage({ type: "s3", ... }) — the intent is unchanged.
const storage = await createStorage({ type: "local", root: "./data" });

async function saveAvatar(file, tenantId, attempts = 3) {
  const intent = avatarIntent(file, tenantId);
  for (let attempt = 1; ; attempt++) {
    try {
      return await saveUploadIntent(storage, intent);
    } catch (error) {
      // Intents are re-runnable: a network blip is just another attempt.
      if (attempt >= attempts || !(error instanceof StorageNetworkError)) throw error;
    }
  }
}

const saved = await saveAvatar(new File(["x"], "me.png", { type: "image/png" }), "t1");
console.log(saved.key); // tenants/t1/avatars/<uuid>.png
```

## 4. Testing upload handling with the fake driver

The fake is a real in-memory driver (no vitest dependency, no network) with
fault injection for error paths.

```ts
// uploads.test.ts
import { expect, it } from "vitest";
import { createFakeStorage } from "@mohamedhabibwork/storagekit/testing/fake";
import { StorageNotFoundError } from "@mohamedhabibwork/storagekit";

it("round-trips an upload through the service logic", async () => {
  const storage = await createFakeStorage();
  await storage.upload("uploads/hello.txt", "hello world");

  expect((await storage.list({ prefix: "uploads/" })).files).toHaveLength(1);
  await expect((await storage.download("uploads/hello.txt")).text()).resolves.toBe("hello world");
  await storage.delete("uploads/hello.txt");

  await expect(storage.download("uploads/hello.txt")).rejects.toThrow(StorageNotFoundError);
});

it("serves fake signed URLs like a signed-capability driver", async () => {
  const storage = await createFakeStorage({ baseUrl: "https://cdn.example.com", signedUrls: true });
  await storage.upload("uploads/hello.txt", "hello world");
  const url = await storage.getSignedUrl("uploads/hello.txt", { expiresIn: 60 });
  expect(url).toContain("https://cdn.example.com");
});
```

The `FakeStorageDriver` itself additionally exposes `seed()`, `reset()`,
`failOnce(operation, error?)`, `clearFailures()`, and a `files` map for fault
injection when you construct it directly.

Run: `npx vitest`. For custom drivers, run the shared behavioral contract
against your own implementation with `defineDriverContractTests` — see
[custom-drivers.md](custom-drivers.md).

## Where to next

- [Framework uploads](uploads.md) — multer/Express/NestJS/Koa, Fastify, Hono, Elysia, Next.js, formidable, busboy recipes.
- Per-driver guides: [local](local.md), [s3](s3.md), [minio](minio.md), [azure](azure.md), [oracle](oracle.md), [r2](r2.md), [rustfs](rustfs.md), [gcs](gcs.md).
- [Custom drivers](custom-drivers.md) and [architecture](architecture.md).
