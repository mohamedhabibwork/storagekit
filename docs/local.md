# Local Filesystem Driver

`import { createLocalStorage } from '@mohamedhabibwork/storagekit/local'`

Zero extra dependencies — built entirely on Node.js built-ins (`node:fs`,
`node:stream`, `node:path`, `node:url`). Works on Node.js >= 20, Bun and
Deno 2.

## Config

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `root` | `string` | required | Root directory; every key resolves inside it |
| `baseUrl` | `string` | — | Public base URL (CDN/static route) powering `getUrl()` |
| `prefix` | `string` | — | Virtual prefix stored under `root`, identical behavior to object stores |
| `permissions` | `{ file?, directory? }` | — | Octal modes for created files/directories (e.g. `0o644`) |
| `createDirectories` | `boolean` | `true` | Create missing parent directories on upload |
| `followSymlinks` | `boolean` | `false` | Follow symlinks in listings/stat by default |

```ts
const storage = await createStorage({
  type: 'local',
  root: './storage/app',
  baseUrl: 'https://cdn.example.com/app',
  permissions: { file: 0o644, directory: 0o755 },
});
```

## Security

Keys are virtual paths (always `/`-separated). The driver normalizes them
and **refuses anything that would escape `root`** with
`StorageInvalidPathError` — `../`, nested `..`, NUL bytes, empty keys.

## Native options

```ts
await storage.upload('secrets/key.pem', pem, {
  native: { mode: 0o600 },                    // fs write mode
});
await storage.download('logs/app.log', {
  native: { encoding: 'utf8' },               // fs read encoding
});
await storage.stat('link.bin', { native: { followSymlinks: true } });
await storage.list({ prefix: 'x/', native: { followSymlinks: true } });
await storage.delete('a/b/c.txt', { native: { cleanEmptyParents: true } });
await storage.getUrl('f.bin', { native: { fileUrl: true } }); // file:// URL
```

## Behavior notes

- `move()` is a real `rename(2)`; on cross-device errors (`EXDEV`) it falls
  back to copy + delete.
- `getUrl()` requires `baseUrl`, otherwise it throws
  `StorageUnsupportedOperationError` (pass `native: { fileUrl: true }` for a
  `file://` URL instead).
- `getSignedUrl()` throws — serve files through your application.
- `metadata` and `versioning` are not supported (`capabilities()` reports
  both as false); upload `metadata` is accepted but not persisted.
- `contentType` is derived from the file extension (built-in MIME table);
  downloads fall back to `application/octet-stream`.
- Directories are real: one-level `list()` returns immediate files plus
  `directories` entries with trailing slashes (`'sub/'`).
- `list({ recursive: true })` performs a deterministic DFS with a
  lexicographic sort so cursor pagination is stable.
- Symlinks are listed with the link's own stats unless followed; recursion
  depth is capped at 100 to survive symlink loops.

## Examples

```ts
// upload from a stream (no buffering)
await storage.upload('videos/movie.mp4', fs.createReadStream('movie.mp4'));

// conflict detection
await storage.upload('config.json', 'v1');
await storage.upload('config.json', 'v2', { overwrite: false }); // StorageConflictError

// range download
const dl = await storage.download('videos/movie.mp4', { range: { offset: 0, length: 1024 } });
```
