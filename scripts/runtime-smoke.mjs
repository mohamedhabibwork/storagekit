/**
 * Runtime compatibility smoke test — runs on Node.js, Bun and Deno.
 * Usage:  node scripts/runtime-smoke.mjs   (or `bun ...` / `deno run -A ...`)
 *
 * Exercises the published surface of the LOCAL driver (Node built-ins only)
 * plus the custom-driver registry, so no cloud SDK is required.
 */
import { createStorage, registerStorageDriver, listStorageTypes, isStorageError, StorageNotFoundError, StorageInvalidPathError } from '../dist/index.js';

const runtime = (() => {
  const g = globalThis;
  if (g.Deno) return `deno ${g.Deno.version.deno}`;
  if (g.Bun) return `bun ${g.Bun.version}`;
  return `node ${process.version}`;
})();

const storage = await createStorage({ type: 'local', root: './.tmp-runtime-smoke', baseUrl: 'https://cdn.example.test' });

// 1. buffer upload/download
await storage.upload('greet/世界.txt', 'héllo', { contentType: 'text/plain' });
const text = await (await storage.download('greet/世界.txt')).text();
if (text !== 'héllo') throw new Error(`roundtrip mismatch: ${text}`);

// 2. stream upload (5 MB) — must not require manual buffering
const chunk = Buffer.alloc(1024 * 1024, 7);
let sent = 0;
const big = new (await import('node:stream')).Readable({
  read() {
    if (sent >= 5 * 1024 * 1024) this.push(null);
    else { sent += chunk.length; this.push(chunk); }
  },
});
await storage.upload('big.bin', big);
const stat = await storage.stat('big.bin');
if (stat.size !== 5 * 1024 * 1024) throw new Error(`stream size mismatch: ${stat.size}`);

// 3. list + iterate — one level: 'big.bin' file + 'greet/' directory
const page = await storage.list({ limit: 10 });
if (page.files.length !== 1 || page.directories[0] !== 'greet/') {
  throw new Error(`list unexpected: ${JSON.stringify({ files: page.files, directories: page.directories })}`);
}
const iterated = [];
for await (const file of storage.iterate()) iterated.push(file.path);
if (iterated.length < 2) throw new Error('iterate incomplete');

// 4. errors: missing + traversal
let notFound = false;
try { await storage.download('nope.txt'); } catch (e) {
  notFound = e instanceof StorageNotFoundError && isStorageError(e);
}
if (!notFound) throw new Error('missing-file error not normalized');
let traversal = false;
try { await storage.upload('../escape.txt', 'x'); } catch (e) {
  traversal = e instanceof StorageInvalidPathError;
}
if (!traversal) throw new Error('traversal not rejected');

// 5. custom driver registry
registerStorageDriver('runtime-smoke', () => ({
  type: 'runtime-smoke',
  async upload(path) { return { path, provider: 'runtime-smoke' }; },
  async download() { throw new Error('unused'); },
  async delete() {}, async deleteMany() { return { deleted: [], failed: [] }; },
  async exists() { return false; }, async stat() { throw new Error('unused'); },
  async list() { return { files: [], directories: [], hasMore: false }; },
  async copy() { return {}; }, async move() { return {}; },
  async getUrl() { return ''; }, async getSignedUrl() { throw new Error('unused'); },
  native() { return {}; }, nativeRequest(fn) { return fn({}); },
  capabilities() { return {}; },
}));
const custom = await createStorage({ type: 'runtime-smoke' });
const up = await custom.upload('a.txt', 'x');
if (up.provider !== 'runtime-smoke') throw new Error('custom driver failed');
if (!listStorageTypes().includes('runtime-smoke')) throw new Error('registry not shared');

// 6. public URL
if ((await storage.getUrl('greet/世界.txt')) !== 'https://cdn.example.test/greet/%E4%B8%96%E7%95%8C.txt') {
  throw new Error('getUrl mismatch');
}

// 7. upload intake — web File/Blob path (the shape Bun/Deno/Hono handlers produce)
const { saveWebFile, sanitizeFilename, randomKey } = await import('../dist/uploads/index.js');
if (sanitizeFilename('../../etc/hosts') !== 'hosts') throw new Error('sanitizeFilename failed');
const webKey = randomKey('uploads-smoke', 'photo.JPG');
if (!/^uploads-smoke\/[0-9a-f-]{36}\.jpg$/.test(webKey)) throw new Error(`randomKey unexpected: ${webKey}`);
const saved = await saveWebFile(storage, new File([new TextEncoder().encode('web upload')], 'photo.JPG', { type: 'image/jpeg' }), { directory: 'uploads-smoke' });
if (saved.originalName !== 'photo.JPG' || saved.mimeType !== 'image/jpeg') throw new Error('saveWebFile metadata mismatch');
const webText = await (await storage.download(saved.key)).text();
if (webText !== 'web upload') throw new Error('saveWebFile roundtrip mismatch');

// cleanup
await storage.delete('greet/世界.txt');
await storage.delete('big.bin');
await storage.delete(saved.key);

console.log(`[${runtime}] smoke passed: upload/download/stream/list/iterate/errors/custom-driver/upload-intake`);
process.exit(0);
