# Creating a Custom Driver

Any storage backend can join the unified API by implementing the
`StorageDriver` interface and registering it under a type name. Custom
drivers:

- resolve through the same `createStorage({ type: '…', ... })` factory
- get hooks, operation events, and error normalization for free (the
  wrapper handles them — your driver only implements storage mechanics)
- can validate themselves against the same contract suite as the builtins

## 1. Implement `StorageDriver<T>`

```ts
import { defineDriver, type StorageDriver } from '@mohamedhabibwork/storagekit';
import type {
  UploadBody, UploadResult, DownloadResult, DeleteManyResult,
  FileStat, ListResult, StorageCapabilities,
} from '@mohamedhabibwork/storagekit';

interface MyConfig {
  type: 'postgres';          // your type name — any non-empty string
  connectionString: string;
  table: string;
}

function createPostgresDriver(config: MyConfig): StorageDriver<'postgres'> {
  return defineDriver({
    type: 'postgres',

    // Store `body` (Buffer | Uint8Array | Readable | Blob | ArrayBuffer | string)
    // under the normalized key. Streams: consume them — never buffer the
    // whole thing unless your backend forces you to.
    async upload(path, body, options): Promise<UploadResult<'postgres'>> {
      // options: { contentType?, contentLength?, metadata?, cacheControl?,
      //            contentDisposition?, contentEncoding?, overwrite? (default true),
      //            signal?, multipart?, native? }
      return { path, size, etag, versionId, url, provider: 'postgres' };
    },

    // Return a Node Readable plus helpers. Missing file → throw
    // StorageNotFoundError (import it from the package).
    async download(path, options): Promise<DownloadResult<'postgres'>> {
      // options: { versionId?, range?: { offset, length? }, signal?, native? }
      const stream = Readable.from(data);
      return {
        stream, contentType, contentLength, etag, lastModified, metadata, versionId,
        provider: 'postgres',
        buffer: () => streamToBuffer(stream),
        text: () => streamToBuffer(stream).then((b) => b.toString('utf8')),
        json: () => streamToBuffer(stream).then((b) => JSON.parse(b.toString('utf8'))),
      };
    },

    // IDEMPOTENT — deleting a missing object must be a no-op.
    async delete(path, options) {},

    async deleteMany(paths, options) {
      return { deleted: string[], failed: [{ path, error }] }; // per-path outcome
    },

    // Metadata/head check — never download the object.
    async exists(path, options) { return false; },
    async stat(path, options): Promise<FileStat<'postgres'>> {
      return { path, size, contentType, etag, lastModified, metadata, provider: 'postgres' };
    },

    // One level deep by default: files at the immediate level plus
    // `directories` entries with TRAILING SLASHES ('sub/').
    // `options.recursive === true` → flat scan of every file under prefix.
    // `options.limit` bounds entries per page; `options.cursor` is opaque —
    // you produce it and consume it verbatim.
    async list(options): Promise<ListResult<'postgres'>> {
      return { files, directories, cursor, hasMore };
    },

    // Server-side copy if your backend can; otherwise stream internally.
    async copy(source, destination, options) {
      return { source, destination, etag?, lastModified? };
    },

    // Convention: copy + delete. Local drivers should use rename instead.
    async move(source, destination, options) {
      return { source, destination, etag? };
    },

    // Unsigned URL. No network requests. Throw
    // StorageUnsupportedOperationError if URLs make no sense for you.
    async getUrl(path, options) { return url; },

    // Throw StorageUnsupportedOperationError when unsupported (that is the
    // contract — never silently emulate).
    async getSignedUrl(path, options) { throw new StorageUnsupportedOperationError('…'); },

    // The real backend client, exposed for advanced users.
    native() { return pool; },
    async nativeRequest(fn) { return fn(pool); },

    capabilities(): StorageCapabilities {
      return {
        signedUrls: false, multipartUpload: false, serverSideCopy: true,
        versioning: false, metadata: true, directories: false, bulkDelete: false,
      };
    },
  });
}
```

Optional but useful:

- **`async ready()`** — if present, `createStorage()` awaits it before the
  storage is returned. Use it for connections/migrations/auth bootstrapping.
- **Normalize keys** with the exported `normalizeKey()` helper (forward
  slashes, duplicate-slash collapse, traversal rejection) so your driver
  behaves like the builtins.

## 2. Register it

```ts
import { registerStorageDriver } from '@mohamedhabibwork/storagekit';

registerStorageDriver('postgres', (config, runtime) =>
  createPostgresDriver(config as unknown as MyConfig));
```

Rules:

- The registry is **global to the process** (shared across package
  entrypoints via a `globalThis` symbol).
- Builtin types (`local`, `s3`, `minio`, `azure`, `oracle`) cannot be
  overridden; duplicate registrations throw `StorageInvalidConfigError`.
- `unregisterStorageDriver(type)` removes a registration (mainly tests);
  `listStorageTypes()` lists everything resolvable.
- Configs keep arbitrary extra fields — only `type` is reserved:

```ts
const storage = await createStorage({
  type: 'postgres',
  connectionString: 'postgres://…',   // your fields, verbatim
  table: 'objects',
});
// → Storage<'postgres'>, native slots typed unknown
```

## 3. Type-level notes

- `Storage<'postgres'>` works everywhere `Storage<...>` is expected; its
  `native` option bags and `native()` fall back to `unknown` (builtins keep
  their strong types). If you want stronger typing, cast at your own
  boundary: `storage.native() as unknown as MyClient`.
- Every option/result interface (`UploadOptions`, `ListOptions`, …) accepts
  any string as its type parameter.

## 4. Validate with the contract suite

The published testing module runs the exact same suite the builtin drivers
must pass:

```ts
// vitest test file
import { defineDriverContractTests } from '@mohamedhabibwork/storagekit/testing';

defineDriverContractTests({
  name: 'postgres',
  createStorage: async () => createStorage({ type: 'postgres', connectionString: testDsn }),
  destroyStorage: async () => { /* cleanup */ },
  capabilities: { signedUrls: false },
});
```

The suite covers: buffer/string/stream uploads, stream downloads, exists,
stat, missing-file errors, idempotent delete, deleteMany, one-level
listings with directories, recursive listing + cursor pagination, iterate,
copy, move, overwrite conflict, empty files, unicode keys, capabilities,
native client access — and signed-URL tests when
`capabilities.signedUrls` is true.

## Semantics checklist (what makes a driver "correct")

- [ ] `delete` of a missing object resolves (idempotent)
- [ ] `download`/`stat` of a missing object throw `StorageNotFoundError`
- [ ] keys normalized: `/` separators, no traversal (`normalizeKey`)
- [ ] `list()` default = one level; `directories` entries end with `/`
- [ ] `list({ recursive: true })` = flat scan; pagination via opaque cursor
- [ ] `overwrite: false` on upload/copy/move → `StorageConflictError`
- [ ] streams consumed, never fully buffered (when avoidable)
- [ ] `signal` respected where the backend supports cancellation
- [ ] errors thrown are package errors (`normalizeError()` wraps anything)
- [ ] unsupported operations throw `StorageUnsupportedOperationError`
- [ ] `native()` returns the same object on every call

A complete working example (in-memory driver passing the full contract
suite) lives in `tests/custom-driver/memory.test.ts` in the repository.
