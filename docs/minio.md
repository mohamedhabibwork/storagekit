# MinIO Driver

`import { createMinioStorage } from '@mohamedhabibwork/storagekit/minio'`

Uses the official `minio` JavaScript client. This is a first-class driver —
**not** an alias of the S3 driver — so MinIO-native options, error codes and
behavior stay available. Works with MinIO server and MinIO S3-compatible
deployments.

```bash
npm install minio
```

## Config

| Option | Type | Description |
| --- | --- | --- |
| `bucket` | `string` | Required. Bucket name |
| `endPoint` | `string` | Required. Hostname (no scheme), e.g. `localhost` |
| `port` | `number` | Defaults to 443 (TLS) / 80 (plain) |
| `useSSL` | `boolean` | Default `true` |
| `accessKey` / `secretKey` | `string` | Credentials (omit to rely on server policy/anonymous) |
| `region` | `string` | Optional region |
| `prefix` | `string` | Virtual prefix for every key |
| `publicUrlBase` | `string` | CDN base URL used by `getUrl()` |
| `clientOptions` | `Partial<minio.ClientOptions>` | Forwarded to `new Client(...)` (`sessionToken`, `transportAgent`, …) |
| `client` | `minio.Client` | Inject an existing client |

```ts
const storage = await createStorage({
  type: 'minio',
  bucket: 'uploads',
  endPoint: 'localhost',
  port: 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});
```

## Upload

`putObject`. Buffers/strings/ArrayBuffers/Blobs upload with a known length;
streams upload with an unknown length, which makes the MinIO client use its
**native multipart machinery automatically**.

```ts
await storage.upload('reports/q1.pdf', buffer, {
  contentType: 'application/pdf',
  metadata: { quarter: 'q1' },          // → x-amz-meta quarter
  native: { metaData: { 'X-Amz-Meta-App': 'finance' } }, // extra bag, merged last
});
```

## Download / stat / delete

`getObject` (or `getPartialObject` for ranges), `statObject`,
`removeObject`/`removeObjects`. Versioned buckets:

```ts
await storage.download('docs/a.pdf', { versionId: 'uuid' });
await storage.download('docs/a.pdf', {
  range: { offset: 100, length: 50 },
  native: { sseCustomerAlgorithm: 'AES256', sseCustomerKey: '…', sseCustomerKeyMD5: '…' },
});
await storage.stat('docs/a.pdf', { versionId: 'uuid' });
await storage.delete('docs/a.pdf', { versionId: 'uuid' });
```

Normalized `stat` picks `content-type` out of the metadata bag
(case-insensitive) and surfaces `metaData` as `metadata`.

## List

One level by default (`delimiter /`), recursive with `recursive: true`.
Implemented over the client's `listObjectsV2Query` so pagination uses real
continuation tokens (1000-key pages) instead of client-side scanning.

## Copy / move

Server-side `copyObject` with native preconditions:

```ts
await storage.copy('a.bin', 'b.bin', {
  native: {
    matchETag: '"d41d8…"',       // copy only if source ETag matches
    matchETagExcept: '…',
    modifiedSince: new Date('2026-01-01'),
    unmodifiedSince: new Date('2026-06-01'),
  },
});
```

> **Note**: MinIO's copy API always preserves source metadata — there is no
> REPLACE directive — so `contentType`/`metadata` overrides on `copy()` are
> silently ignored by this driver (unlike S3). `move()` is copy + delete.

## deleteMany

Uses native `removeObjects` (single batched request). If the batch call
fails as a whole it retries per-object so the result reports per-path
failures; the per-object error entries the server returns are mapped back to
package errors.

## URLs

```ts
await storage.getUrl('images/logo.png');
// https://<endPoint>[:port]/<bucket>/<key>   (or publicUrlBase)

await storage.getSignedUrl('private.pdf', { expiresIn: 3600,
  native: { responseHeaders: { 'response-content-disposition': 'attachment; filename="a.pdf"' },
            requestDate: new Date() } });
await storage.getSignedUrl('upload.bin', { action: 'write', expiresIn: 900 });
await storage.getSignedUrl('old.bin',   { action: 'delete', expiresIn: 300 });
```

## Capabilities

`signedUrls: true`, `multipartUpload: true`, `serverSideCopy: true`,
`versioning: true`, `metadata: true`, `directories: false`,
`bulkDelete: true`.

## Testing against a real MinIO server

```bash
MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \
  minio server /tmp/data --address :9000
MINIO_TEST_ENDPOINT=localhost MINIO_TEST_PORT=9000 \
MINIO_TEST_ACCESS_KEY=minioadmin MINIO_TEST_SECRET_KEY=minioadmin \
MINIO_TEST_BUCKET=test-bucket \
npx vitest run tests/integrations/minio.test.ts
```
