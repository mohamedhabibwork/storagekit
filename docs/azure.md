# Azure Blob Storage Driver

`import { createAzureStorage } from '@mohamedhabibwork/storagekit/azure'`

Backed by `@azure/storage-blob` (v12). The SDK is an optional peer
dependency and loads lazily.

```bash
npm install @azure/storage-blob
```

## Config

| Option | Type | Description |
| --- | --- | --- |
| `container` | `string` | Required. Container name (must be valid: 3–63 chars, lowercase/digits/hyphens) |
| `connectionString` | `string` | Auth route 1 — also enables SAS generation |
| `accountUrl` + `credential` | `string` + `StorageSharedKeyCredential \| TokenCredential` | Auth route 2 (`@azure/identity` `DefaultAzureCredential` works here) |
| `serviceClient` | `BlobServiceClient` | Auth route 3 — inject an existing service client |
| `containerClient` | `ContainerClient` | Auth route 4 — inject an existing container client |
| `prefix` | `string` | Virtual prefix for every key |
| `publicUrlBase` | `string` | CDN base URL used by `getUrl()` |

At least one auth route is required; the factory validates this.

```ts
// connection string (Azurite/local dev or account keys)
const storage = await createStorage({
  type: 'azure',
  container: 'uploads',
  connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
});

// managed identity / Entra ID
import { DefaultAzureCredential } from '@azure/identity';
const prod = await createStorage({
  type: 'azure',
  container: 'uploads',
  accountUrl: 'https://myaccount.blob.core.windows.net',
  credential: new DefaultAzureCredential(),
});
```

## Upload

Streams go through `uploadStream` (block-blob staging — never buffered);
buffers/strings/`Blob`s go through `uploadData`.

```ts
await storage.upload('videos/movie.mp4', stream, {
  contentType: 'video/mp4',
  multipart: { partSize: 8 * 1024 * 1024, concurrency: 5 }, // block size / parallelism
  native: {
    tier: 'Cool',                                   // access tier: Hot | Cool | Cold | Archive
    tags: { project: 'media' },                     // blob index tags
    conditions: { ifNoneMatch: '*' },               // e-tag conditions
    blobHTTPHeaders: { blobContentEncoding: 'gzip' },
  },
});
```

`native` accepts any `BlockBlobUploadOptions` field except the ones the
package maps (`metadata`, `abortSignal`, `tracingOptions`); common HTTP
headers land in `blobHTTPHeaders` automatically.

## Download / stat / delete

```ts
const dl = await storage.download('docs/report.pdf', {
  versionId: '2026-01-01T…',                          // → blobClient.withVersion()
  range: { offset: 0, length: 2048 },                 // → download(offset, count)
  native: { conditions: { tagConditions: "project = 'media'" } },
});
await storage.stat('docs/report.pdf', { versionId: '…' });
await storage.delete('docs/report.pdf', { versionId: '…' }); // idempotent (404 → no-op)
```

## List

One level by default via `listBlobsByHierarchy('/')` (delimiters become
`directories` entries with trailing slashes); `recursive: true` uses
`listBlobsFlat`. Pagination uses Azure continuation tokens.

```ts
await storage.list({ prefix: 'users/100/', limit: 250,
  native: { includeDeleted: false, includeTags: true } });
```

## Copy / move

`beginCopyFromURL` (server-side). Same-account copies complete quickly; the
driver polls the copy poller up to ~30 attempts and throws if the copy is
still pending (use `nativeRequest()` for long-running copies). Cross-account
sources need a SAS in the source URL — construct it yourself and pass it via
`nativeRequest()`/`native` options.

```ts
await storage.copy('temp/a.jpg', 'images/a.jpg', {
  contentType: 'image/jpeg',
  native: { tier: 'Cool', conditions: { ifModifiedSince: new Date() } },
});
```

## Signed URLs (SAS)

Generated from shared-key credentials (connection string or
`StorageSharedKeyCredential`). `TokenCredential` accounts need user
delegation keys — not supported directly; use `nativeRequest()` with
`getUserDelegationKey` + `generateBlobSASQueryParameters`.

```ts
await storage.getSignedUrl('private.pdf', { expiresIn: 3600,
  native: { contentType: 'application/pdf',
            contentDisposition: 'attachment; filename="report.pdf"',
            protocol: 'https', ipRange: { start: { ipAddress: '203.0.113.0' } } } });
await storage.getSignedUrl('upload.bin', { action: 'write', expiresIn: 900 }); // permissions 'cw'
await storage.getSignedUrl('old.bin',   { action: 'delete', expiresIn: 300 }); // permissions 'd'
```

Actions map to SAS permissions: `read` → `r`, `write` → `cw`, `delete` →
`d`. Pass `native.expiresOn` to override the expiry mechanism entirely.

## Capabilities

`signedUrls: true`, `multipartUpload: true`, `serverSideCopy: true`,
`versioning: true`, `metadata: true`, `directories: false`,
`bulkDelete: false` — `deleteMany` runs parallel per-blob deletes (Azure
batch is account-type dependent).

## Testing against Azurite

```bash
npx azurite --blobHost 127.0.0.1 --blobPort 10000
AZURE_TEST_CONNECTION_STRING='DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;' \
npx vitest run tests/integrations/azure.test.ts
```

The contract suite passes fully against Azurite, including SAS generation.
