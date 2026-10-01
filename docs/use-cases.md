# Use cases

Every common file-storage task, with a short runnable example using the
public API. Examples assume:

```ts
import { createStorage } from "@mohamedhabibwork/storagekit";

const storage = await createStorage({ type: "s3", bucket: "app-files", region: "us-east-1" });
```

Any provider works the same way — swap the config (`local`, `minio`, `azure`,
`oracle`, `rustfs`, `r2`, `gcs`, or a custom driver).

## Upload a file (buffer, string or stream)

```ts
await storage.upload("users/1/avatar.jpg", buffer, { contentType: "image/jpeg" });
await storage.upload("notes/readme.txt", "hello");
await storage.upload("videos/movie.mp4", fs.createReadStream("movie.mp4"));
```

## Large / multipart uploads

```ts
await storage.upload("backups/db.tar.gz", stream, {
  multipart: { enabled: true, partSize: 16 * 1024 * 1024, concurrency: 4 },
});
```

## Metadata, cache headers and content disposition

```ts
await storage.upload("invoices/42.pdf", pdf, {
  contentType: "application/pdf",
  metadata: { customerId: "42" },
  cacheControl: "private, max-age=0",
  contentDisposition: 'attachment; filename="invoice-42.pdf"',
});
const { metadata, size, contentType } = await storage.stat("invoices/42.pdf");
```

## Write-once (no overwrite)

```ts
import { StorageConflictError } from "@mohamedhabibwork/storagekit";

try {
  await storage.upload("ledger/2026-10-01.json", data, { overwrite: false });
} catch (error) {
  if (error instanceof StorageConflictError) console.log("already written");
}
```

## Download (stream, buffer, text, JSON)

```ts
const file = await storage.download("documents/report.pdf");
file.stream.pipe(response);

const config = await (await storage.download("config.json")).json<{ flag: boolean }>();
```

## Range reads (partial content / video seeking)

```ts
const part = await storage.download("videos/movie.mp4", {
  range: { offset: 0, length: 1024 * 1024 },
});
```

## Existence and metadata checks

```ts
if (await storage.exists("users/1/avatar.jpg")) {
  const stat = await storage.stat("users/1/avatar.jpg");
  console.log(stat.size, stat.etag, stat.lastModified);
}
```

## Delete one or many files

```ts
await storage.delete("tmp/a.txt"); // idempotent
const { deleted, failed } = await storage.deleteMany(["tmp/b.txt", "tmp/c.txt"]);
```

## Delete a whole "directory" (prefix)

```ts
import { deletePrefix } from "@mohamedhabibwork/storagekit";

const { deleted, failed } = await deletePrefix(storage, "users/1/", { batchSize: 500 });
```

An empty prefix is rejected so a bucket can never be wiped by accident.

## List with pagination

```ts
let cursor: string | undefined;
do {
  const page = await storage.list({ prefix: "users/", limit: 100, cursor });
  console.log(page.files, page.directories);
  cursor = page.cursor;
} while (cursor);
```

## Iterate a huge prefix lazily

```ts
for await (const file of storage.iterate("logs/2026/")) {
  console.log(file.path, file.size);
}
```

## Collect a listing into an array

```ts
import { listAll } from "@mohamedhabibwork/storagekit";

const images = await listAll(storage, "uploads/", {
  filter: (file) => file.path.endsWith(".png"),
  max: 10_000, // guard against unbounded memory
});
```

## Copy, move and rename

```ts
await storage.copy("temp/image.jpg", "images/image.jpg"); // server-side
await storage.move("temp/file.pdf", "documents/file.pdf");
```

## Copy between providers (migration, backup)

```ts
import { copyBetween } from "@mohamedhabibwork/storagekit";

await copyBetween(s3, "docs/file.pdf", azure, "archive/file.pdf", {
  onProgress: (bytes, total) => console.log(`${bytes}/${total ?? "?"}`),
});
```

## Integrity checks (checksums)

```ts
import { checksum } from "@mohamedhabibwork/storagekit";

const sha256 = await checksum(storage, "backups/db.tar.gz");
const md5 = await checksum(storage, "a.bin", { algorithm: "md5", encoding: "base64" });
```

The file is streamed through the hash; ETags are not reliable checksums.

## Public URLs

```ts
const url = await storage.getUrl("images/logo.png"); // no network request
```

## Signed (temporary) download URLs

```ts
const url = await storage.getSignedUrl("documents/private.pdf", { expiresIn: 900 });
```

## Direct browser uploads (signed write URLs)

```ts
const uploadUrl = await storage.getSignedUrl(`uploads/${crypto.randomUUID()}`, {
  action: "write",
  expiresIn: 300,
});
// client: await fetch(uploadUrl, { method: "PUT", body: file });
```

Oracle uses pre-authenticated requests instead (`storagekit/oracle`,
`createPreauthenticatedRequest()`); the local driver serves files through
your app.

## Multi-tenant namespaces (scoped storage)

```ts
import { scopedStorage } from "@mohamedhabibwork/storagekit";

const tenant = scopedStorage(storage, `tenants/${tenantId}`);
await tenant.upload("docs/a.txt", "x"); // stored at tenants/<id>/docs/a.txt
const page = await tenant.list(); // paths reported relative to the scope
await tenant.download("../other/a.txt"); // throws StorageInvalidPathError
```

For a whole-disk namespace use the `prefix` config option instead.

## Framework uploads (Express, Fastify, Hono, Next.js, …)

```ts
import { saveUpload } from "@mohamedhabibwork/storagekit";

app.post("/avatar", upload.single("file"), async (req, res) => {
  const saved = await saveUpload(storage, req.file, { directory: "avatars" });
  res.json(saved);
});
```

See [uploads.md](uploads.md) for every framework.

## Several disks in one app

```ts
import { createStorageManager } from "@mohamedhabibwork/storagekit";

const disks = createStorageManager({
  default: "uploads",
  disks: {
    uploads: { type: "s3", bucket: "uploads" },
    temp: { type: "local", root: "./storage/temp" },
  },
});
await (await disks.disk("temp")).upload("a.txt", "hi");
```

## Versioned objects

```ts
const old = await storage.download("report.pdf", { versionId: "3HL4kqtJlcpXroDTDmJ" });
```

## Cancel an operation

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);
await storage.upload("big.bin", stream, { signal: controller.signal });
```

## Error handling

```ts
import { StorageNotFoundError } from "@mohamedhabibwork/storagekit";

try {
  await storage.download("missing.txt");
} catch (error) {
  if (error instanceof StorageNotFoundError) console.log(error.provider, error.path);
}
```

## Hooks, metrics and audit logs

```ts
const storage = await createStorage(config, {
  hooks: { beforeDelete: (ctx) => audit("delete", ctx.path) },
  onOperation: (event) => metrics.timing(`storage.${event.operation}`, event.duration),
});
```

## Feature detection

```ts
if (storage.capabilities().signedUrls) {
  return storage.getSignedUrl(path);
}
```

## Provider-native features

```ts
await storage.upload("a.txt", "x", { native: { StorageClass: "GLACIER" } }); // S3-typed
const client = storage.native(); // S3Client
```

## Custom drivers

See [custom-drivers.md](custom-drivers.md) — `defineDriver()` plus
`registerStorageDriver()`, verified with the shared contract suite.

## Testing with the in-memory fake

```ts
import { createFakeStorage } from "@mohamedhabibwork/storagekit/testing/fake";

const storage = await createFakeStorage({ initialFiles: { "seed.txt": "hi" } });
```

## Deliberately out of scope

- **Resumable uploads across process restarts** (tus, S3 multipart resume) —
  provider-specific; use `nativeRequest()`.
- **Bucket lifecycle / ACL / CORS management** — infrastructure concerns;
  use `native()`.
- **Image transforms / thumbnails** — pair with a dedicated library.
