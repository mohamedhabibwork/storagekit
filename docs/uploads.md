# Framework uploads

storagekit plugs directly into the upload middleware of any framework. Every
upload package — multer, `@fastify/multipart`, formidable, busboy, or the
web-standard `File`/`Blob` that Hono, Next.js, Remix, Nuxt, Elysia, `Bun.serve`
and Deno produce — ends up as the same three facts: a field name, a client
filename, and a body (stream, buffer or blob). `storagekit/uploads` turns that
into a `storage.upload()` call with a safe object key, on **any** driver
(Local, S3, MinIO, Azure, Oracle, custom).

No adapter imports its framework: each one satisfies the framework's shape
structurally, so every framework package stays an *optional* peer dependency.

| Entry point | Use with |
| --- | --- |
| `storagekit/uploads` | Any framework — `saveUpload()`, `saveWebFile()`, helpers |
| `storagekit/adapters/express` | Express, NestJS, koa-multer (multer storage engine) |
| `storagekit/adapters/fastify` | Fastify 4/5 with `@fastify/multipart` |
| `storagekit/adapters/formidable` | formidable v2/v3 (any framework) |

## Core: `saveUpload()`

```ts
import { createLocalStorage } from '@mohamedhabibwork/storagekit/local';
import { saveUpload } from '@mohamedhabibwork/storagekit/uploads';

const storage = await createLocalStorage({ type: 'local', root: './data' });

// file: whatever your middleware handed you
const saved = await saveUpload(storage, {
  body: file.stream,          // stream, Buffer, or Blob
  fieldname: file.fieldname,
  originalName: file.originalname,
  mimeType: file.mimetype,
}, { directory: 'uploads' });

await db.insert(attachments).values({
  key: saved.key,             // uploads/<uuid>.png
  name: saved.originalName,   // exact client filename, untouched
  etag: saved.result.etag,
});
```

What it does for you:

- **Key generation** — random UUID keys under `directory`, extension taken
  from the client filename (`report.pdf` → `<uuid>.pdf`). The stem is never
  client-controlled, so uploads can never target or overwrite arbitrary keys.
- **Traversal safety** — explicit `key` strings (and key-function results) go
  through `normalizeKey()`: `../` escapes throw `StorageInvalidPathError`.
- **Metadata** — `originalname`, `fieldname`, `mimetype` are stored as object
  metadata automatically (merge more via `metadata: {...}`, disable with
  `metadata: false`).
- **Streaming** — stream bodies are piped straight through; with a known
  `size`, it is forwarded as `contentLength` (S3 and friends can then avoid
  buffering).
- **Provider-native options** — pass `native` through untouched (S3
  `StorageClass`, Azure `tier`, ...), plus `signal`, `overwrite`,
  `contentType`.

```ts
await saveUpload(storage, file, {
  key: `users/${user.id}/avatar.jpg`,   // or a resolver: (file) => ...
  overwrite: false,                     // second upload of same key fails
  metadata: { userId: String(user.id) },
  native: { StorageClass: 'STANDARD_IA' },   // typed per storage type
});
```

Helpers: `sanitizeFilename(name)` (basename, strips control/Windows-hostile
chars, caps at 255 preserving the extension) and
`randomKey(directory, originalName)`.

## Express — multer storage engine

`createMulterStorage()` is a drop-in multer `StorageEngine`: uploads stream
directly into storage (no disk scratch, no memory buffering), and the result
lands on `req.file`.

```ts
import express from 'express';
import multer from 'multer';
import { createMulterStorage } from '@mohamedhabibwork/storagekit/adapters/express';

const upload = multer({
  storage: createMulterStorage(storage, {
    directory: 'uploads',            // or key: (file) => `users/${file.fieldname}/...`
  }),
});

app.post('/upload', upload.single('avatar'), (req, res) => {
  res.json({
    key: req.file!.key,              // stored object key
    etag: req.file!.etag,
    url: req.file!.url,              // when the provider exposes one
    name: req.file!.originalname,
    // full record also on req.file!.storagekit
  });
});
```

Behavior details:

- Key failures (resolver throws, `overwrite: false` conflict) reject the
  upload and surface as normal multer/Express errors — add your error
  middleware as usual.
- If the request aborts or the handler errors, multer calls `_removeFile` and
  the already-stored object is **deleted from storage** (disable with
  `removeOnError: false`).
- TypeScript augmentation for the merged fields:

```ts
import type { SavedUpload } from '@mohamedhabibwork/storagekit/uploads';

declare global {
  namespace Express {
    namespace Multer {
      interface File {
        key?: string;
        etag?: string;
        url?: string;
        storagekit?: SavedUpload;
      }
    }
  }
}
```

**NestJS** — `FileInterceptor` accepts any multer storage:

```ts
@Post('avatar')
@UseInterceptors(FileInterceptor('avatar', {
  storage: createMulterStorage(storage, { directory: 'avatars' }),
}))
upload(@UploadedFile() file: Express.Multer.File) {
  return { key: file.key, name: file.originalname };
}
```

**Koa** — `koa-multer` uses the same engine interface, so
`createMulterStorage()` works unchanged.

## Fastify — `@fastify/multipart`

```ts
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { saveFastifyFile } from '@mohamedhabibwork/storagekit/adapters/fastify';

const app = Fastify();
await app.register(multipart);

app.post('/upload', async (req, reply) => {
  const part = await req.file();
  if (!part) return reply.code(400).send({ error: 'no file' });
  const saved = await saveFastifyFile(storage, part, { directory: 'uploads' });
  return { key: saved.key, name: saved.originalName };
});
```

The part's stream is consumed by the storage upload — required before the
reply is sent. On failure the stream is destroyed so the request settles.

## Hono, Next.js, Remix, Nuxt, Elysia, Bun & Deno — web `File`

Every framework built on the web standard hands you `File` objects from
`request.formData()` / `c.req.parseBody()`. `saveWebFile()` picks up `name`,
`type` and `size` automatically:

```ts
// Hono
app.post('/upload', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];
  if (!(file instanceof File)) return c.json({ error: 'no file' }, 400);
  const saved = await saveWebFile(storage, file, { directory: 'uploads' });
  return c.json({ key: saved.key });
});
```

```ts
// Next.js App Router route handler
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get('file') as File;
  const saved = await saveWebFile(storage, file, { directory: 'uploads' });
  return Response.json({ key: saved.key });
}
```

The same call works with `Bun.serve`, `Deno.serve` and Elysia handlers — the
runtime smoke test exercises exactly this path on Node, Bun and Deno.

## formidable (any framework)

formidable writes uploads to temp files first; the adapter streams that temp
file into storage:

```ts
import formidable from 'formidable';
import { saveFormidableFile } from '@mohamedhabibwork/storagekit/adapters/formidable';

app.post('/upload', (req, res) => {
  const form = formidable();
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).end();
    const upload = Array.isArray(files.file) ? files.file[0] : files.file;
    const saved = await saveFormidableFile(storage, upload, { directory: 'uploads' });
    res.json({ key: saved.key });
  });
});
```

## Anything else

For upload packages without a dedicated adapter (busboy directly, GraphQL
Upload, tRPC, custom pipelines), wrap what the package yields into an
`UploadFileInput` and call `saveUpload()` — that single function is the whole
integration surface.

## Security notes

- Client filenames are only ever used for the generated key's **extension**
  (sanitized, lowercased, max 16 chars) and for metadata — never the key stem.
- `originalName` in metadata and on the result preserves the exact client
  string (control characters stripped) for auditing.
- The MIME type reported by the client is untrusted: validate it in your
  handler (or via the `contentType` override) before serving objects back.
