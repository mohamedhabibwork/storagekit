# RustFS

[RustFS](https://rustfs.com) is an Apache-2.0 S3-compatible object storage
written in Rust. Because the project ships no first-party JS SDK, you talk
to it through the official AWS SDK for JavaScript v3 — which is exactly
what storagekit's RustFS driver does. The driver adds RustFS-specific
defaults on top of the S3 surface so you can point at your server and go.

```ts
import { createRustfsStorage } from '@mohamedhabibwork/storagekit/rustfs';

const storage = await createRustfsStorage({
  type: 'rustfs',
  bucket: 'uploads',
  endpoint: 'http://localhost:9000', // RustFS S3 API
  accessKeyId: 'rustfsadmin',        // dev-only default; set RUSTFS_ACCESS_KEY in prod
  secretAccessKey: 'rustfsadmin',
});

await storage.upload('avatars/1.jpg', fileStream, {
  contentType: 'image/jpeg',
  native: { StorageClass: 'STANDARD_IA' }, // AWS-shaped options, typed per storage type
});
```

The subpath entrypoint and `type: 'rustfs'` exist for discoverability and
for the user-facing identifier to be `'rustfs'` end to end (in result
objects, errors, events). Under the hood, `native()` returns the same
`S3Client` that storagekit's S3 driver builds, so every operation that
works against S3 works against RustFS unchanged.

## Why a dedicated type?

RustFS is wire-compatible with S3 but it is its own server: distinct
install, default credentials, default region, default path-style setting.
The driver bakes those defaults in (you can still override any of them):

| Setting | RustFS default | storagekit default if you omit it |
| --- | --- | --- |
| `region` | `us-east-1` | `us-east-1` |
| `forcePathStyle` | `true` | `true` |
| `endpoint` | (required) | n/a — you must supply it |

Without this driver you would still be able to talk to RustFS through the
S3 entrypoint by setting these explicitly:

```ts
import { createS3Storage } from '@mohamedhabibwork/storagekit/s3';
const storage = await createS3Storage({
  type: 's3',
  bucket: 'uploads',
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'rustfsadmin', secretAccessKey: 'rustfsadmin' },
});
```

— that still works and the storage you get back is `Storage<'s3'>`.
Use `storagekit/rustfs` when you want the result objects and errors
labelled as `provider: 'rustfs'` instead of `'s3'`, and to keep the
RustFS defaults discoverable.

## Install

```bash
npm install @mohamedhabibwork/storagekit
# The RustFS entrypoint shares the AWS SDK v3 with the S3 driver —
# install only what you use (all are optional peers):
npm install @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner
```

Server SDKs never ship to consumers who do not import the matching
entrypoint.

## Full config

```ts
interface RustfsStorageConfig {
  type: 'rustfs';
  bucket: string;
  endpoint: string;                         // required — RustFS S3 API URL
  region?: string;                          // default 'us-east-1'
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  } | AwsCredentialIdentityProvider;
  forcePathStyle?: boolean;                 // default true
  prefix?: string;                          // virtual prefix on every key
  publicUrlBase?: string;                   // base URL for getUrl()
  client?: S3Client;                        // inject a pre-built client
  clientOptions?: Partial<S3ClientConfig>;  // forwarded to `new S3Client(...)`
}
```

`prefix` and `publicUrlBase` behave exactly like the S3 driver: prefix
is transparently applied on every operation and stripped from results;
`publicUrlBase` powers `getUrl()` (which never performs a network call).

## Common operations

```ts
// upload — Buffer, string, Uint8Array, ArrayBuffer, Blob or Node stream
await storage.upload('avatars/1.jpg', buffer, {
  contentType: 'image/jpeg',
  cacheControl: 'public,max-age=31536000',
});

// download — stream-first
const dl = await storage.download('reports/q1.pdf');
dl.stream.pipe(response);                 // Node Readable
const text = await dl.text();

// metadata, existence, delete (idempotent — deleting missing is a no-op)
await storage.exists('a.txt');
const stat = await storage.stat('a.txt'); // { size, etag, contentType, ... }
await storage.delete('a.txt');

// list / iterate
const page = await storage.list({ prefix: 'avatars/', limit: 100 });
for await (const f of storage.iterate('avatars/')) console.log(f.path);

// copy / move (server-side)
await storage.copy('tmp/a.jpg', 'images/a.jpg');
await storage.move('tmp/b.pdf', 'docs/b.pdf');
```

## Presigned URLs

```ts
// presigned GET (default)
const url = await storage.getSignedUrl('private/report.pdf', { expiresIn: 3600 });

// presigned PUT — let the browser upload directly to RustFS
const put = await storage.getSignedUrl('upload-target.bin', {
  action: 'write',
  expiresIn: 900,
});

// presigned DELETE
const del = await storage.getSignedUrl('to-remove.bin', { action: 'delete' });
```

`expiresIn` is in seconds, capped at 7 days. Native options pass through
to the underlying command input (`ResponseContentDisposition`,
`ResponseContentType`, `VersionId`, …).

## Provider-native options under `native`

Every `Storage<'rustfs'>` method that touches the server accepts the same
`native` option bag as `Storage<'s3'>` — that is the AWS SDK v3 input
minus the fields storagekit already maps:

```ts
await storage.upload('a.bin', body, {
  contentType: 'application/octet-stream',
  native: {
    StorageClass: 'STANDARD_IA',
    ServerSideEncryption: 'AES256',
    ACL: 'private',
    Tagging: 'env=prod',
  },
});
```

`native` is merged last and overrides common equivalents when both set
the same field.

## Escaping the abstraction

```ts
// raw S3Client (RustFS has no separate JS SDK)
const client = storage.native();

// any AWS SDK v3 call the package does not wrap
const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
await storage.nativeRequest(async (c) => c.send(new HeadObjectCommand({
  Bucket: 'uploads', Key: 'a.bin',
})));
```

## Uploads from a framework

RustFS storage composes with the framework upload adapters unchanged —
the S3-compatible surface is identical:

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

## Local dev: running RustFS

The fastest path is the official single-binary download — see
[Installation](https://docs.rustfs.com/en/installation). For a throwaway
local trial, the defaults (`rustfsadmin` / `rustfsadmin`, no TLS, port
9000) are fine; replace them before exposing the server.

```bash
# install the binary (macOS / Linux — see the install page for Windows)
curl -fsSL https://rustfs.com/install.sh | sh

# start with the default credentials, data dir under /var/lib/rustfs
RUSTFS_ACCESS_KEY=rustfsadmin \
RUSTFS_SECRET_KEY=rustfsadmin \
rustfs /var/lib/rustfs
```

Then point storagekit at it:

```ts
const storage = await createRustfsStorage({
  type: 'rustfs',
  bucket: 'uploads',
  endpoint: 'http://localhost:9000',
  credentials: {
    accessKeyId: 'rustfsadmin',
    secretAccessKey: 'rustfsadmin',
  },
});
```

## Operational notes

- **Path style vs virtual host**: RustFS uses path-style URLs by default.
  `forcePathStyle: true` is set for you. Switch to virtual-host only when
  the server has `RUSTFS_SERVER_DOMAINS` configured.
- **Region**: RustFS ignores the region but the AWS SDK requires one.
  Use `us-east-1` (its default) unless you have a reason otherwise.
- **Versioning**: `versionId` is accepted on download / stat / delete and
  propagated to the SDK call. Enable versioning server-side.
- **Encryption**: `ServerSideEncryption: 'AES256'` passes through; KMS
  options map onto SSEKMSKeyId / SSEKMSEncryptionContext exactly as with
  S3.
- **Server-side copy**: `storage.copy(...)` uses `CopyObject`; cross-region
  copies work when the destination bucket exists in another region.

## What it does not support

- **Transfer acceleration** — `useAccelerateEndpoint` has no RustFS equivalent.
- **S3 Select** — not in RustFS.
- **Inventory / analytics / replication rules** — use the RustFS admin API
  or the `rc` CLI.

For everything else, every S3-compatible call works against RustFS the
same way. If something is missing or behaves differently, open an issue
at <https://github.com/mohamedhabibwork/storagekit/issues>.
