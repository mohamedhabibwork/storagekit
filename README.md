# storagekit

Unified TypeScript file management across multiple storage providers — with
strongly-typed **native provider options** preserved instead of flattened
into a lowest-common-denominator API.

```ts
import { createStorage } from '@mohamedhabibwork/storagekit';

const storage = await createStorage({
  type: 's3',
  bucket: 'uploads',
  region: 'eu-central-1',
});

await storage.upload('users/100/avatar.jpg', fileStream, {
  contentType: 'image/jpeg',
  // normalized, works on every provider
  cacheControl: 'public,max-age=31536000',
  // real AWS options, typed per storage type
  native: {
    StorageClass: 'INTELLIGENT_TIERING',
    ServerSideEncryption: 'AES256',
  },
});
```

Change `type: 's3'` to `type: 'azure'` and TypeScript now offers Azure-native
options (`tier: 'Cool'`, SAS conditions, …) — and **rejects** AWS ones.

## Providers

| Provider | Entrypoint | SDK |
| --- | --- | --- |
| Local filesystem | `storagekit/local` | Node built-ins only |
| AWS S3 | `storagekit/s3` | `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner` |
| MinIO | `storagekit/minio` | `minio` |
| Azure Blob Storage | `storagekit/azure` | `@azure/storage-blob` |
| Oracle OCI Object Storage | `storagekit/oracle` | `oci-objectstorage`, `oci-common` |

All provider SDKs are **optional peer dependencies**. Import only the
entrypoint you use; when a driver is loaded without its SDK installed you
get a clear `StorageInvalidConfigError` with the exact `npm install`
command instead of a module crash.

Requires **Node.js ≥ 20**. Ships dual ESM + CJS with TypeScript
declarations. Browser usage is not a goal: server-side credentials and
filesystem access are first-class here.

## The design rule

> Common operations share one API. Provider-specific behavior stays under
> the strongly-typed `native` key, based on the configured storage type.

```ts
{
  // ── normalized (same everywhere) ──
  contentType: 'image/jpeg',
  metadata: { userId: '100' },
  overwrite: false,
  multipart: { partSize: 10 * 1024 * 1024, concurrency: 4 },
  signal: controller.signal,

  // ── provider-specific (typed by the storage type) ──
  native: {
    // Storage<'s3'>: PutObjectCommandInput fields (StorageClass, ACL, SSEKMSKeyId, …)
    // Storage<'azure'>: { tier: 'Cool', conditions, tags, blobHTTPHeaders, … }
    // Storage<'minio'>: { metaData: { … } }
    // Storage<'oracle'>: { storageTier: 'Archive', ifMatch, opcMeta, … }
    // Storage<'local'>: { mode: 0o600 }
  },
}
```

`native` is merged last: it overrides the common equivalents when both are
given.

## Quick start (every provider)

```ts
import { createStorage } from '@mohamedhabibwork/storagekit';

// Local
const local = await createStorage({
  type: 'local',
  root: './storage/app',
  baseUrl: 'https://cdn.example.com', // optional, powers getUrl()
});

// AWS S3 (credentials resolve through the normal AWS chain when omitted)
const s3 = await createStorage({
  type: 's3',
  bucket: 'my-files',
  region: 'eu-west-1',
});

// MinIO
const minio = await createStorage({
  type: 'minio',
  bucket: 'uploads',
  endPoint: 'localhost',
  port: 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

// Azure Blob (connection string, shared key, TokenCredential, or inject clients)
const azure = await createStorage({
  type: 'azure',
  container: 'uploads',
  connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
});

// Oracle — native auth providers, never access-key style
const oracle = await createStorage({
  type: 'oracle',
  namespaceName: 'mynamespace',
  bucketName: 'mybucket',
  region: 'eu-frankfurt-1',
  auth: { type: 'instance-principals' },
});
```

You can also inject pre-built native clients for dependency injection:
`client` (S3 / MinIO / Oracle), `serviceClient` / `containerClient` (Azure),
or `authProvider` (Oracle).

## Core operations

```ts
// upload — Buffer, string, Uint8Array, ArrayBuffer, Blob or Node stream
await storage.upload('users/1/avatar.jpg', buffer, {
  contentType: 'image/jpeg',
});

// upload from a stream — never buffered into memory
await storage.upload('videos/movie.mp4', readableStream, {
  multipart: { enabled: true, partSize: 10 * 1024 * 1024, concurrency: 4 },
});

// download — stream-first
const download = await storage.download('documents/report.pdf');
download.stream.pipe(response);          // Node Readable
const text = await download.text();       // or .buffer() / .json()
download.contentType;                     // normalized metadata
download.etag; download.contentLength; download.metadata;

// existence & metadata (native HEAD calls, never full downloads)
await storage.exists('users/1/avatar.jpg');
const stat = await storage.stat('users/1/avatar.jpg'); // size, etag, contentType, …

// delete (idempotent — deleting a missing object is a no-op)
await storage.delete('users/1/avatar.jpg');
await storage.deleteMany(['a.jpg', 'b.jpg', 'c.jpg']); // per-path outcome report

// list — one level (default) or recursive, with opaque cursors
const page = await storage.list({ prefix: 'users/100/', limit: 100 });
page.files;        // StorageFile[] (path, size, etag, lastModified, …)
page.directories;  // ['users/100/sub/'] — trailing slash, one level
page.cursor;       // pass back via { cursor } to continue
page.hasMore;

// async iteration for very large buckets — pagination handled for you
for await (const file of storage.iterate('uploads/')) {
  console.log(file.path);
}

// copy (server-side) & move (copy + delete; rename on local)
await storage.copy('temp/image.jpg', 'images/image.jpg');
await storage.move('temp/file.pdf', 'documents/file.pdf');
```

## URLs

```ts
// public URL — never performs network requests
await storage.getUrl('images/logo.png');

// signed URLs — read (default) / write / delete
await storage.getSignedUrl('documents/private.pdf', { expiresIn: 3600 });
await storage.getSignedUrl('upload-target.bin', {
  action: 'write',
  expiresIn: 900,
  native: { ResponseContentDisposition: 'attachment; filename="invoice.pdf"' }, // S3
});
```

- **S3 / MinIO**: presigned URLs with full native options.
- **Azure**: SAS tokens from shared-key credentials or connection strings.
  `TokenCredential`-based signing needs user delegation keys — use
  `nativeRequest()` with `getUserDelegationKey`.
- **Local**: unsupported — serve files through your app (throw
  `StorageUnsupportedOperationError`).
- **Oracle**: no presigned URLs. The `storagekit/oracle` entrypoint adds a
  provider-specific `createPreauthenticatedRequest()` because PARs have a
  fundamentally different lifecycle (persistent server-side resources).

Expiry is validated: between 1 second and 7 days (`expiresIn`).

## Escaping the abstraction

```ts
// the real native client, typed per provider
const client = storage.native(); // S3Client | ContainerClient | Minio.Client | ObjectStorageClient | LocalNativeClient

// any SDK operation the package does not wrap
const info = await storage.nativeRequest((c) => c.someAdvancedSdkCall());

// Azure versioned downloads, Oracle PARs, S3 Select, … all stay reachable
```

## Multiple disks

```ts
import { createStorageManager } from 'storagekit';

const disks = createStorageManager({
  default: 'uploads',
  disks: {
    uploads: { type: 's3', bucket: 'uploads' },
    backup: { type: 'azure', container: 'backup', accountUrl: 'https://acct.blob.core.windows.net' },
    temp: { type: 'local', root: './storage/temp' },
  },
});

await disks.disk('uploads').upload('a.txt', '…');   // Storage<'s3'>
await disks.disk('backup').upload('a.txt', '…');    // Storage<'azure'>
await disks.disk('temp').delete('a.txt');           // Storage<'local'>
```

## Cross-storage copy

```ts
import { copyBetween } from 'storagekit';

await copyBetween(sourceStorage, 'docs/file.pdf', destinationStorage, 'archive/file.pdf', {
  concurrency: 4,
  onProgress: (bytes, total) => console.log(`${bytes}/${total ?? '?'}`),
});
```

Streams source → destination; the file is never fully buffered. For copies
inside one provider prefer `storage.copy()` (server-side).

## Errors

```ts
import {
  StorageError,
  StorageNotFoundError,
  StoragePermissionError,
  StorageConflictError,
  StorageInvalidConfigError,
  StorageNetworkError,
  StorageQuotaError,
  StorageUnsupportedOperationError,
  StorageInvalidPathError,
} from 'storagekit';

try {
  await storage.download(path);
} catch (error) {
  if (error instanceof StorageNotFoundError) {
    // handle missing object
  }
  error.provider;   // 's3' | 'local' | …
  error.operation;  // 'download'
  error.path;
  error.code;       // provider-native code when available
  error.cause;      // the original SDK error
}
```

Provider errors are normalized into the classes above while the original
error stays on `cause`. Deleting missing objects is idempotent everywhere.

## Prefixes

```ts
const storage = await createStorage({
  type: 's3',
  bucket: 'application',
  prefix: 'production/',
});

await storage.upload('users/avatar.jpg', file);
// stored as production/users/avatar.jpg
```

Prefix behavior is identical across providers — every operation (upload,
download, list, copy, URLs, …) applies and strips it consistently. Local
paths additionally can **never escape the configured root**
(`../../etc/passwd` throws `StorageInvalidPathError`).

## Hooks & observability

```ts
const storage = await createStorage(config, {
  hooks: {
    beforeUpload: (ctx) => log.debug('uploading', ctx.path),
    afterUpload: (ctx) => metrics.count('upload'),
    uploadError: (ctx) => alert(ctx.error),
    beforeDelete: (ctx) => audit(ctx.path),
  },
  onOperation: (event) => {
    event.provider; event.operation; event.duration; event.success;
  },
});

// subscribe later
const off = storage.on('operation', (event) => { … });
off(); // unsubscribe
```

Hooks receive sanitized contexts — credentials and signed URLs never appear.

## Versioning & encryption

Provider semantics differ and are not hidden: `download`/`stat`/`delete`
accept a normalized `versionId` (S3, Azure, MinIO, Oracle), while native
controls (S3 `ServerSideEncryption: 'aws:kms'`, Azure access tiers, OCI
`storageTier`) remain available through `native`.

## Testing your own driver

The shared contract suite is published so custom drivers can prove they
behave like the built-ins:

```ts
import { defineDriverContractTests } from '@mohamedhabibwork/storagekit/testing';

defineDriverContractTests({
  name: 'my-driver',
  createStorage: () => createMyStorage(config),
  capabilities: { signedUrls: true },
});
```

## Development

```bash
npm install
npm test              # unit + contract + mocked-OCI tests
npm run test:types    # type-level assertions
npm run typecheck     # strict tsc
npm run build         # dual ESM/CJS + d.ts via tsup
```

Cloud integration tests are env-gated (see `tests/integrations/*.ts`):
LocalStack for S3, `minio/minio` Docker for MinIO, Azurite for Azure, and
opt-in live OCI (`OCI_INTEGRATION_TESTS=true`).

## Security notes

- Credentials, connection strings, SAS tokens and signed URLs are never
  logged or embedded in normalized error messages.
- Local driver paths are validated against traversal and escape the root
  with `StorageInvalidPathError`.
- Signed URL lifetimes are bounded (1 s – 7 days).

## License

MIT
