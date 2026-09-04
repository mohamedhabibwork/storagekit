# Google Cloud Storage

[Google Cloud Storage](https://cloud.google.com/storage) is the
object-storage service on Google Cloud. storagekit drives it through
the official [`@google-cloud/storage`](https://www.npmjs.com/package/@google-cloud/storage)
Node.js client — the same SDK Google publishes and maintains — so the
GCS driver speaks the GCS REST API exactly the way every other GCS
client does, including all native GCS options.

```ts
import { createGcsStorage } from '@mohamedhabibwork/storagekit/gcs';

// On Google Cloud (Cloud Run, GKE, GCE, Cloud Functions, …) — picks up
// Application Default Credentials from the metadata server.
const storage = await createGcsStorage({
  type: 'gcs',
  bucket: 'my-app-uploads',
});

await storage.upload('avatars/1.jpg', fileStream, {
  contentType: 'image/jpeg',
  native: { kmsKeyName: 'projects/p/locations/l/keyRings/r/cryptoKeys/k' },
});
```

```ts
// Off-cloud — service-account JSON file or inline credentials.
const storage = await createGcsStorage({
  type: 'gcs',
  bucket: 'my-app-uploads',
  projectId: 'my-project',
  keyFilename: '/etc/secrets/gcs-key.json',
});
```

The subpath entrypoint and `type: 'gcs'` exist for discoverability and
so the user-facing identifier (`result.provider`, error tags, hook
events) is `'gcs'` end to end. Under the hood, `native()` returns the
`Storage` instance the SDK builds, so every SDK call the package does
not wrap is reachable through `nativeRequest()`.

## Why a dedicated type?

GCS has its own REST API and its own client library. While it is
possible to reach GCS through S3 interoperability (`Storage → S3`),
that mode is officially a "feature with known gaps" (no native
lifecycle, no IAM uniform bucket-level access, no resumable uploads,
no V4 signed POST policies, limited metadata, …). The GCS driver uses
the official GCS SDK and exposes the full `FileMetadata` shape on
every operation — the right tool for any real GCS workload.

If you only need a simple bucket and your data is already S3-shaped,
the S3-compat endpoint also works through `storagekit/s3`. Pick the
GCS driver when you want every GCS feature and a typed `native` bag.

## Install

```bash
npm install @mohamedhabibwork/storagekit
# The GCS entrypoint is the only place that imports the SDK — install only
# if you actually use it (optional peer dependency).
npm install @google-cloud/storage
```

The Google SDK ships native TypeScript types and brings in
`google-auth-library` for credentials resolution; storagekit never
imports either except through this entrypoint.

## Authentication

Authentication is delegated to `google-auth-library` through
`@google-cloud/storage`. In priority order:

1. `credentials` — an explicit `CredentialBody` (parsed from JSON), an
   object with `client_email` + `private_key`, or an `AuthClient`
   from `google-auth-library`.
2. `keyFilename` — a path to a service-account JSON key file.
3. **Application Default Credentials** — auto-detected from
   `GOOGLE_APPLICATION_CREDENTIALS`, gcloud user credentials,
   `gke-metadata`, `compute-metadata`, or any other ADC source the
   Google SDK recognises.

On Cloud Run / GKE / GCE / Cloud Functions, the simplest path is **no
config at all** — the metadata server supplies project ID and
credentials. Off-cloud, ship a JSON key and point at it with
`keyFilename`.

> Never commit service-account keys. Read them from a secret manager,
> an environment variable (`GOOGLE_APPLICATION_CREDENTIALS=/var/run/...`),
> or a Kubernetes secret mounted at runtime.

## Full config

```ts
interface GcsStorageConfig {
  type: 'gcs';
  bucket: string;                            // required
  projectId?: string;                        // optional — auto from ADC
  keyFilename?: string;                      // path to SA JSON key
  credentials?: GcsStorageOptions['credentials'];  // inline creds
  apiEndpoint?: string;                      // override (emulators)
  retryOptions?: RetryOptions;               // SDK retry tuning
  prefix?: string;                           // virtual prefix on every key
  publicUrlBase?: string;                    // base for getUrl() if CDN-fronted
  client?: Storage;                          // inject a pre-built client
  clientOptions?: Partial<StorageOptions>;  // forwarded to new Storage()
}
```

`prefix` and `publicUrlBase` behave exactly like the S3 / MinIO
drivers: prefix is transparently applied on every operation and
stripped from results; `publicUrlBase` powers `getUrl()` (which never
performs a network call).

## Common operations

```ts
// upload — Buffer, string, Uint8Array, ArrayBuffer, Blob or Node stream
await storage.upload('avatars/1.jpg', buffer, {
  contentType: 'image/jpeg',
  cacheControl: 'public,max-age=31536000',
  metadata: { userId: '100' },
});

// download — stream-first
const dl = await storage.download('reports/q1.pdf');
dl.stream.pipe(response);                 // Node Readable
const text = await dl.text();

// metadata, existence, delete (idempotent — deleting missing is a no-op)
await storage.exists('a.txt');
const stat = await storage.stat('a.txt'); // { size, contentType, etag, ... }
await storage.delete('a.txt');

// list / iterate
const page = await storage.list({ prefix: 'avatars/', limit: 100 });
for await (const f of storage.iterate('avatars/')) console.log(f.path);

// copy / move (server-side, atomic on a single bucket)
await storage.copy('tmp/a.jpg', 'images/a.jpg');
await storage.move('tmp/b.pdf', 'docs/b.pdf');
```

GCS resumable uploads are used for every body type — the SDK streams
large bodies in chunks and survives flaky networks without re-uploading
from the top.

## Presigned URLs (V4)

```ts
// V4 GET — preferred for new code
const read = await storage.getSignedUrl('private/report.pdf', { expiresIn: 3600 });

// V4 PUT — direct browser upload to a single object
const put = await storage.getSignedUrl('upload-target.bin', {
  action: 'write',
  expiresIn: 900,
  native: { contentType: 'image/jpeg' },
});

// V4 DELETE
const del = await storage.getSignedUrl('to-remove.bin', { action: 'delete' });
```

`expiresIn` is in seconds, capped at 7 days. The SDK signs with the
service-account key by default; for `v4` with URL-bound IAM, attach
the signer role to the bucket. `native.version` can override the
default (`'v4'`).

## Provider-native options under `native`

Every `Storage<'gcs'>` method that touches the server accepts the GCS
SDK's native options:

```ts
await storage.upload('a.bin', body, {
  contentType: 'application/octet-stream',
  metadata: { env: 'prod' },
  native: {
    kmsKeyName: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
    predefinedAcl: 'private',         // bucket-level ACL shortcut
    chunkSize: 8 * 1024 * 1024,        // resumable upload chunk size
    // any other CreateWriteStreamOptions field
  },
});
```

`native` is merged last and overrides common equivalents when both set
the same field.

## Escaping the abstraction

```ts
// raw @google-cloud/storage Storage client
const client = storage.native();

// any SDK call the package does not wrap
const { Bucket } = await import('@google-cloud/storage');
await storage.nativeRequest(async (s) => {
  await s.bucket('other-bucket').file('x.txt').setMetadata({ metadata: { foo: 'bar' } });
});
```

## Uploads from a framework

GCS storage composes with the framework upload adapters unchanged —
the unified surface is identical:

```ts
import multer from 'multer';
import { createMulterStorage } from '@mohamedhabibwork/storagekit/adapters/express';

app.post('/upload', multer({
  storage: createMulterStorage(storage, { directory: 'avatars' }),
}).single('avatar'), (req, res) => res.json({
  key: req.file!.key, etag: req.file!.etag,
}));
```

See [`docs/uploads.md`](uploads.md) for every recipe (Express, NestJS,
Fastify, Hono, Next.js, formidable, web `File`).

## Local dev — `fake-gcs-server`

The fastest path to a GCS-compatible local server is
[`fake-gcs-server`](https://github.com/fsouza/fake-gcs-server), which
implements the GCS REST API end-to-end. Run it via Docker:

```bash
docker run -d --rm \
  --name fake-gcs \
  -p 9023:9023 \
  -e STORAGE_EMULATOR_HOST=0.0.0.0:9023 \
  fsouza/fake-gcs-server:latest \
  -scheme http -port 9023 -external-url http://localhost:9023
```

Point storagekit at it (the SDK accepts `apiEndpoint` + an empty
`credentials` object for emulators):

```ts
const storage = await createGcsStorage({
  type: 'gcs',
  bucket: 'test-bucket',
  projectId: 'local-dev',
  apiEndpoint: 'http://localhost:9023',
  credentials: { client_email: 'fake@example.com', private_key: 'fake' },
});
```

Production remains the same config minus the `apiEndpoint` and
`credentials` overrides.

## Operational notes

- **Resumable uploads**: every `storage.upload(...)` uses GCS resumable
  uploads under the hood. The chunk size is controlled by
  `native.chunkSize` (default 8 MiB).
- **Versioning**: `versionId` is GCS's `generation` — a monotonically
  increasing 64-bit integer per object. Pass it back to `download` /
  `stat` / `delete` to operate on a specific generation.
- **Encryption**: `kmsKeyName` (in `native`) maps onto customer-managed
  encryption keys (CMEK). For Google-managed encryption you do not
  have to set anything.
- **Object metadata**: `metadata.userMetadata` is the user-facing bag.
  Top-level fields (`cacheControl`, `contentType`, `contentEncoding`,
  `contentDisposition`) are first-class.
- **Predefined ACLs**: `native.predefinedAcl` (`'private'`,
  `'publicRead'`, …). For uniform bucket-level access, prefer IAM.
- **Bulk delete**: GCS has no batch-delete endpoint — `deleteMany`
  issues individual `delete()` calls in parallel and reports per-path
  outcomes. (`capabilities().bulkDelete === false`.)

## What it does not support

- **Bucket administration** — `createBucket`, lifecycle rules, IAM
  policies, retention, etc. Use the `Bucket` API directly via
  `nativeRequest()` for these.
- **gcloud CLI parity** — auth via gcloud user credentials works
  because the SDK handles it, but the driver never shells out.
- **S3-compatible emulation** — use the S3 driver (or the `s3` config
  on the GCS bucket) for that. The `gcs` driver uses the GCS REST
  API.

For everything else, every GCS REST call the package does not wrap
stays reachable through `nativeRequest()`. If something is missing or
behaves differently, open an issue at
<https://github.com/mohamedhabibwork/storagekit/issues>.
