# Oracle Cloud Infrastructure Object Storage Driver

`import { createOracleStorage } from '@mohamedhabibwork/storagekit/oracle'`

Backed by `oci-objectstorage` + `oci-common`. The SDKs are optional peer
dependencies and load lazily.

```bash
npm install oci-common oci-objectstorage
```

## Config

| Option | Type | Description |
| --- | --- | --- |
| `namespaceName` | `string` | Required. Object Storage namespace (stable per tenancy — `oci os ns get`) |
| `bucketName` | `string` | Required. Bucket name |
| `region` | `string` | Region (`eu-frankfurt-1`, …); needed by `getUrl()` and `copy()` unless overridden |
| `prefix` | `string` | Virtual prefix for every key |
| `publicUrlBase` | `string` | CDN base URL used by `getUrl()` |
| `auth` | `OracleAuth` | Declarative auth (below); ignored when `authProvider` is set. Defaults to `{ type: 'config-file' }` |
| `authProvider` | `AuthenticationDetailsProvider` | Inject a ready native provider (wins over `auth`) |
| `client` | `ObjectStorageClient` | Inject an existing client (DI/tests) |
| `clientOptions` | `object` | Forwarded to `new ObjectStorageClient(...)` |

## Authentication

Oracle-native providers only — access-key style credentials are
intentionally unsupported:

```ts
auth: { type: 'config-file', configFilePath?: string, profile?: string }  // ~/.oci/config
auth: { type: 'instance-principals' }   // compute instances (async build)
auth: { type: 'resource-principals' }   // functions / OKE
auth: { type: 'provider', provider: myProvider }  // custom
```

## Upload

Buffers → single `PutObject` with `contentLength`. Streams → **native
multipart** (`createMultipartUpload` → `uploadPart` × N with bounded
concurrency → `commitMultipartUpload`; `abortMultipartUpload` on failure).
Part size: default 64 MiB, floor 1 MiB, ceiling 128 MiB; concurrency default
4 (max 16).

```ts
await storage.upload('backups/db.dump', stream, {
  contentType: 'application/octet-stream',
  multipart: { partSize: 128 * 1024 * 1024, concurrency: 8 },
  metadata: { env: 'prod' },                       // → opcMeta
  native: {
    storageTier: 'Archive',                        // Standard | InfrequentAccess | Archive
    ifNoneMatch: '*',                              // conditional create
    opcChecksumAlgorithm: 'SHA256',
  },
});
```

## Download / stat / delete

`GetObject` (response `value` stream), `HeadObject`, `DeleteObject`.

```ts
const dl = await storage.download('docs/report.pdf', {
  versionId: '…',
  range: { offset: 1024, length: 2048 },           // → native common.Range
  native: { opcSseCustomerAlgorithm: 'AES256' },
});
await storage.stat('docs/report.pdf', { versionId: '…' });   // opcMeta → metadata
await storage.delete('docs/report.pdf', { versionId: '…' });
```

## List

`ListObjects` with `fields: 'name,size,etag,timeModified'`, `delimiter: '/'`
unless recursive, `start` from the cursor, `nextStartWith` out.

```ts
await storage.list({ prefix: 'logs/2026/', limit: 500,
  native: { startAfter: 'logs/2026/06-01', end: 'logs/2026/07-01' } });
```

## Copy / move

Server-side `CopyObject`. `destinationRegion` / `destinationNamespace`
default from the config but can be overridden in `native` for cross-region
or cross-tenancy copies. OCI copies are asynchronous server-side work — the
response carries a work-request id, so the result has no `etag`.

```ts
await storage.copy('a.txt', 'b.txt', {
  native: { destinationRegion: 'us-ashburn-1', destinationObjectStorageTier: 'Archive' },
});
await storage.move('tmp/a.txt', 'docs/a.txt');   // copy + delete
```

## Pre-authenticated requests (PARs)

OCI has **no presigned URLs** — `getSignedUrl()` throws
`StorageUnsupportedOperationError`. Instead, the `oracle` entrypoint extends
`Storage<'oracle'>` with `createPreauthenticatedRequest()`. PARs are
persistent server-side resources (lifecycle + scope differ fundamentally
from presigned URLs):

```ts
import { createOracleStorage } from '@mohamedhabibwork/storagekit/oracle';

const storage = await createOracleStorage({ type: 'oracle', namespaceName: 'ns', bucketName: 'b' });
const par = await storage.createPreauthenticatedRequest({
  objectName: 'reports/q1.pdf',       // or objectPrefix for many objects
  accessType: 'ObjectRead',           // ObjectRead | ObjectWrite | ObjectReadWrite | AnyObjectReadWrite …
  timeExpires: new Date(Date.now() + 3600_000),
  name: 'q1-report-par',
});
// par.accessUri — the pre-authenticated URL; par.id — delete it when done:
// storage.nativeRequest(c => c.deletePreauthenticatedRequest({ … }))
```

## Capabilities

`signedUrls: false`, `multipartUpload: true`, `serverSideCopy: true`,
`versioning: true`, `metadata: true`, `directories: false`,
`bulkDelete: false` — `deleteMany` runs parallel per-object deletes.

## Testing

OCI has no local emulator. The mocked suite
(`tests/oracle/oracle.mocked.test.ts`) asserts exact request shapes against
a scripted client — namespace/bucket/prefix mapping, `opcMeta`, multipart
part commits, delimiter/cursor mapping, 404 normalization, PAR errors.

Live tests are opt-in and run against a real tenancy:

```bash
OCI_INTEGRATION_TESTS=true \
OCI_TEST_NAMESPACE=my-namespace OCI_TEST_BUCKET=my-bucket OCI_TEST_REGION=eu-frankfurt-1 \
npx vitest run tests/integrations/oracle.test.ts
```
