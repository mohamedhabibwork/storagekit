# Framework uploads

storagekit plugs directly into the upload middleware of any framework. Every
upload package — multer, `@fastify/multipart`, formidable, busboy, or the
web-standard `File`/`Blob` that Hono, Next.js, Remix, Nuxt, Elysia, `Bun.serve`
and Deno produce — ends up as the same three facts: a field name, a client
filename, and a body (stream, buffer or blob). `storagekit/uploads` turns that
into a `storage.upload()` call with a safe object key, on **any** driver
(Local, S3, MinIO, RustFS, Azure, Oracle, custom).

No adapter imports its framework: each one satisfies the framework's shape
structurally, so every framework package stays an *optional* peer dependency.

| Entry point | Use with |
| --- | --- |
| `storagekit/uploads` | Any framework — `saveUpload()`, `saveWebFile()`, helpers |
| `storagekit/adapters/express` | Express, NestJS, Koa (`@koa/multer`) — multer storage engine |
| `storagekit/adapters/fastify` | Fastify 4/5 with `@fastify/multipart` |
| `storagekit/adapters/formidable` | formidable v2/v3 (any framework) |
| — (via `saveUpload()`) | busboy, GraphQL Upload, anything yielding a stream |

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
  `size`, it is forwarded as `contentLength` (S3-compatible drivers can then
  avoid buffering).
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

## Express — complete example

`createMulterStorage()` is a drop-in multer `StorageEngine`: uploads stream
directly into storage (no disk scratch, no memory buffering), and the result
lands on `req.file`. A full upload/serve app:

```ts
import express from 'express';
import multer from 'multer';
import { createLocalStorage } from '@mohamedhabibwork/storagekit/local';
import { createMulterStorage } from '@mohamedhabibwork/storagekit/adapters/express';

const storage = await createLocalStorage({
  type: 'local',
  root: './data',
  baseUrl: 'http://localhost:3000/files',   // makes getUrl() work
});

const upload = multer({
  storage: createMulterStorage(storage, { directory: 'uploads' }),
  limits: { fileSize: 10 * 1024 * 1024 },   // 10 MB — see “Validation”
});

const app = express();

// store a file → { key, url, etag }
app.post('/upload', upload.single('file'), (req, res) => {
  res.json({
    key: req.file!.key,          // stored object key (uploads/<uuid>.<ext>)
    url: req.file!.url,          // public URL when the provider derives one
    etag: req.file!.etag,
    name: req.file!.originalname,
  });
});

// stream a file back through the server
app.get('/files/*splat', async (req, res, next) => {
  try {
    const key = req.params.splat;                 // Express 5; v4: req.params[0]
    const file = await storage.download(key);
    res.setHeader('content-type', file.contentType ?? 'application/octet-stream');
    if (file.contentLength !== undefined) res.setHeader('content-length', String(file.contentLength));
    file.stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

// hand out a time-limited link instead (S3/MinIO/RustFS/Azure)
app.get('/link/*splat', async (req, res, next) => {
  try {
    res.json({ url: await storage.getSignedUrl(req.params.splat, { expiresIn: 600 }) });
  } catch (error) { next(error); }
});

app.listen(3000);
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

### Multiple files in Express

```ts
// N files under one field name
app.post('/gallery', upload.array('photos', 12), (req, res) => {
  res.json({ keys: req.files!.map((f) => f.key) });
});

// different fields at once: req.files.avatar, req.files.contract
app.post('/apply', upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'contract', maxCount: 1 },
]), (req, res) => {
  const { avatar, contract } = req.files as Record<string, Express.Multer.File[]>;
  res.json({ avatar: avatar[0].key, contract: contract[0].key });
});
```

## NestJS

`FileInterceptor` accepts any multer storage — the engine works unchanged:

```ts
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('uploads')
export class UploadsController {
  @Post('avatar')
  @UseInterceptors(FileInterceptor('avatar', {
    storage: createMulterStorage(storage, { directory: 'avatars' }),
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  upload(@UploadedFile() file: Express.Multer.File) {
    return { key: file.key, name: file.originalname, url: file.url };
  }
}
```

## Koa

`@koa/multer` (the maintained koa fork) uses the same engine interface:

```ts
import Koa from 'koa';
import Router from '@koa/router';
import koaMulter from '@koa/multer';
import { createMulterStorage } from '@mohamedhabibwork/storagekit/adapters/express';

const upload = koaMulter({
  storage: createMulterStorage(storage, { directory: 'uploads' }),
});

const router = new Router();
router.post('/upload', upload.single('file'), async (ctx) => {
  ctx.body = { key: ctx.file!.key, name: ctx.file!.originalname };
});
```

## Fastify — `@fastify/multipart`

```ts
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { saveFastifyFile } from '@mohamedhabibwork/storagekit/adapters/fastify';

const app = Fastify();
await app.register(multipart);

// single file
app.post('/upload', async (req, reply) => {
  const part = await req.file();
  if (!part) return reply.code(400).send({ error: 'no file' });
  const saved = await saveFastifyFile(storage, part, { directory: 'uploads' });
  return { key: saved.key, name: saved.originalName };
});

// every file in the form — fields are yielded too, skip them
app.post('/upload-many', async (req) => {
  const keys: string[] = [];
  for await (const part of req.files()) {
    if (part.type !== 'file') continue;
    const saved = await saveFastifyFile(storage, part, { directory: 'uploads' });
    keys.push(saved.key);
  }
  return { keys };
});
```

The part's stream is consumed by the storage upload — required before the
reply is sent. On failure the stream is destroyed so the request settles.

## Hono

```ts
import { Hono } from 'hono';
import { saveWebFile } from '@mohamedhabibwork/storagekit/uploads';

const app = new Hono();

app.post('/upload', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];
  if (!(file instanceof File)) return c.json({ error: 'no file' }, 400);
  const saved = await saveWebFile(storage, file, { directory: 'uploads' });
  return c.json({ key: saved.key, name: saved.originalName });
});

// multiple files under one field name
app.post('/gallery', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const photos = body['photos'];
  const files = Array.isArray(photos) ? photos : [photos];   // single upload → singleton
  const keys = [];
  for (const file of files) {
    const saved = await saveWebFile(storage, file as File, { directory: 'gallery' });
    keys.push(saved.key);
  }
  return c.json({ keys });
});
```

## Next.js (App Router) / Remix / Nuxt

Route handlers get a web-standard `Request`, so `formData()` + `saveWebFile()`
is the whole integration:

```ts
// app/api/upload/route.ts
import { saveWebFile } from '@mohamedhabibwork/storagekit/uploads';

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'missing file' }, { status: 400 });
  }
  const saved = await saveWebFile(storage, file, { directory: 'uploads' });
  return Response.json({ key: saved.key, url: saved.result.url });
}
```

The identical handler body works in a Remix action and a Nuxt server route
(`defineEventHandler` with `readFormData`).

## Elysia

Elysia validates uploads with its own `t.File()` schema, then hands you a web
`File`:

```ts
import { Elysia, t } from 'elysia';
import { saveWebFile } from '@mohamedhabibwork/storagekit/uploads';

new Elysia()
  .post('/upload', async ({ body: { file } }) => {
    const saved = await saveWebFile(storage, file, { directory: 'uploads' });
    return { key: saved.key };
  }, {
    body: t.Object({ file: t.File({ type: 'image' }) }),   // MIME validated by Elysia
  })
  .listen(3000);
```

## Bun & Deno

`Bun.serve` and `Deno.serve` use the web-standard `Request`/`Response` pair,
so one handler shape covers both:

```ts
Bun.serve({
  port: 3000,
  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/upload') {
      return new Response('not found', { status: 404 });
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return new Response('missing file', { status: 400 });
    const saved = await saveWebFile(storage, file, { directory: 'uploads' });
    return Response.json({ key: saved.key });
  },
});

// Deno: the same body inside Deno.serve({ handler }) — nothing changes.
```

The runtime smoke test (`scripts/runtime-smoke.mjs`) exercises exactly this
web-`File` path on Node, Bun and Deno on every build.

## formidable (any framework)

formidable writes uploads to temp files first; the adapter streams that temp
file into storage:

```ts
import formidable from 'formidable';
import { saveFormidableFile } from '@mohamedhabibwork/storagekit/adapters/formidable';

app.post('/upload', (req, res) => {
  const form = formidable({
    maxFileSize: 10 * 1024 * 1024,   // 10 MB — formidable enforces this
    uploadDir: os.tmpdir(),
  });
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: err.message });
    const raw = files.file;
    const upload = Array.isArray(raw) ? raw[0] : raw;
    if (!upload) return res.status(400).json({ error: 'missing file' });
    const saved = await saveFormidableFile(storage, upload, { directory: 'uploads' });
    res.json({ key: saved.key, name: saved.originalName });
  });
});
```

## Anything else — busboy, GraphQL Upload

For upload packages without a dedicated adapter, wrap what the package yields
into an `UploadFileInput` and call `saveUpload()` — that single function is
the whole integration surface.

**busboy** (streaming parser — the same file events multer is built on):

```ts
import busboy from 'busboy';

app.post('/upload', (req, res) => {
  const bb = busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024 } });
  const keys: string[] = [];

  bb.on('file', async (fieldname, stream, info) => {
    try {
      const saved = await saveUpload(storage, {
        body: stream,                       // piped straight into storage
        fieldname,
        originalName: info.filename,
        mimeType: info.mimeType,
      }, { directory: 'busboy' });
      keys.push(saved.key);
    } catch {
      stream.destroy();                     // let the request settle on failure
    }
  });

  bb.on('error', () => res.status(400).end());
  bb.on('close', () => res.json({ keys }));
  req.pipe(bb);
});
```

**GraphQL Upload** (`graphql-upload` scalar — the promise yields a stream,
filename and mimetype):

```ts
// resolver for `upload(file: Upload!): Attachment!`
async upload(_parent, { file }) {
  const { createReadStream, filename, mimetype } = await file;
  const saved = await saveUpload(storage, {
    body: createReadStream(),
    originalName: filename,
    mimeType: mimetype,
  }, { directory: 'graphql' });
  return { key: saved.key, name: saved.originalName };
}
```

## Serving files back

Three patterns, pick per sensitivity:

```ts
// 1. Public URL — no network request, works when the provider can derive one
//    (local needs baseUrl; S3/MinIO/RustFS public buckets; Azure public containers).
const url = await storage.getUrl(key);

// 2. Signed URL — time-limited, no traffic through your server.
//    S3 / MinIO / RustFS / Azure SAS:
const link = await storage.getSignedUrl(key, { action: 'read', expiresIn: 600 });
// Oracle has no presigned URLs — use pre-authenticated requests (PARs) via
// the Oracle driver's native options instead.

// 3. Stream through the server — full control (auth, audit, transforms).
const file = await storage.download(key);
file.stream.pipe(response);          // set content-type from file.contentType
```

With the multer engine, `req.file.url` is pattern 1 filled in at upload time.

## Validation

Client-reported MIME types and sizes are **requests**, not facts — enforce
your own limits.

**Express/multer** — `limits` + `fileFilter` run *before* the storage engine,
so rejected files never reach storage:

```ts
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const upload = multer({
  storage: createMulterStorage(storage, { directory: 'uploads' }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error(`unsupported type: ${file.mimetype}`));
  },
});
```

**`saveUpload()` flows** (Fastify, Hono, web `File`, …) — validate the part
in the handler before saving:

```ts
const MAX_SIZE = 10 * 1024 * 1024;

if (!ALLOWED_TYPES.has(file.type)) return reply.code(415).send({ error: 'unsupported type' });
if (file.size > MAX_SIZE) return reply.code(413).send({ error: 'too large' });

const saved = await saveWebFile(storage, file, { directory: 'uploads' });
```

**Sniff real content** for anything user-facing — `file-type` reads a few
bytes from the stream's head and detects the actual format, independent of
what the client claimed. Cross-check it against `file.type` before serving
objects back with a content type.

## Security notes

- Client filenames are only ever used for the generated key's **extension**
  (sanitized, lowercased, max 16 chars) and for metadata — never the key stem.
- `originalName` in metadata and on the result preserves the exact client
  string (control characters stripped) for auditing.
- The MIME type reported by the client is untrusted: validate it (see
  [Validation](#validation)) before serving objects back.
- Generated keys are UUIDs — uploads cannot collide with or target existing
  objects. Explicit keys are traversal-checked at both compile time and
  runtime.
