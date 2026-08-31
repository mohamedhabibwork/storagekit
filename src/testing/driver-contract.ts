import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { StorageError, StorageNotFoundError, StorageConflictError } from '../core/errors';
import type { Storage, StorageCapabilities } from '../core/types';

export interface DriverContractOptions {
  /** Human-readable provider name for the describe block. */
  name: string;
  /** Build a fresh Storage instance for the suite (called once). */
  createStorage: () => Promise<Storage<any>>;
  /** Called after the suite to release resources (tmp dirs etc.). */
  destroyStorage?: () => Promise<void>;
  /** Provider capabilities; signed-URL tests only run when enabled. */
  capabilities?: Partial<StorageCapabilities>;
}

function bufferToStream(buffer: Buffer): Readable {
  return new Readable({
    read() {
      this.push(buffer);
      this.push(null);
    },
  });
}

/**
 * The shared driver contract. Every provider must pass the same behavioral
 * suite; provider-specific abilities are gated on `capabilities()`.
 */
export function defineDriverContractTests(options: DriverContractOptions): void {
  describe(`${options.name} driver contract`, () => {
    let storage: Storage<any>;
    const uploaded: string[] = [];

    const track = (path: string): string => {
      uploaded.push(path);
      return path;
    };

    beforeEach(async () => {
      storage = await options.createStorage();
      uploaded.length = 0;
    });

    afterEach(async () => {
      await Promise.allSettled(uploaded.map((path) => storage.delete(path)));
      await options.destroyStorage?.();
    });

    it('uploads and downloads a buffer', async () => {
      const path = track(`contract/${randomUUID()}/file.txt`);
      await storage.upload(path, Buffer.from('hello world'), {
        contentType: 'text/plain',
      });
      const result = await storage.download(path);
      const buffer = await result.buffer();
      expect(buffer.toString('utf8')).toBe('hello world');
      expect(result.provider).toBe(storage.type);
    });

    it('uploads and downloads strings, text() and json()', async () => {
      const textPath = track(`contract/${randomUUID()}/note.txt`);
      await storage.upload(textPath, 'plain text');
      await expect((await storage.download(textPath)).text()).resolves.toBe('plain text');

      const jsonPath = track(`contract/${randomUUID()}/data.json`);
      await storage.upload(jsonPath, JSON.stringify({ ok: true }));
      const download = await storage.download(jsonPath);
      expect(await download.json<{ ok: boolean }>()).toEqual({ ok: true });
    });

    it('streams large uploads without buffering them manually', async () => {
      const path = track(`contract/${randomUUID()}/large.bin`);
      const chunk = Buffer.alloc(1024 * 1024, 7);
      let sent = 0;
      const stream = new Readable({
        read() {
          if (sent >= 10 * 1024 * 1024) {
            this.push(null);
            return;
          }
          sent += chunk.length;
          this.push(chunk);
        },
      });
      await storage.upload(path, stream, { contentType: 'application/octet-stream' });

      const stat = await storage.stat(path);
      expect(stat.size).toBe(10 * 1024 * 1024);
    });

    it('downloads as a stream', async () => {
      const path = track(`contract/${randomUUID()}/video.bin`);
      await storage.upload(path, Buffer.alloc(64 * 1024, 1));
      const download = await storage.download(path);
      expect(download.stream).toBeInstanceOf(Readable);
      await result2buffer(download.stream);
    });

    it('checks existence', async () => {
      const path = track(`contract/${randomUUID()}/maybe.txt`);
      expect(await storage.exists(path)).toBe(false);
      await storage.upload(path, 'now I exist');
      expect(await storage.exists(path)).toBe(true);
    });

    it('stats files', async () => {
      const path = track(`contract/${randomUUID()}/stats.jpg`);
      await storage.upload(path, Buffer.from('jpegdata'), { contentType: 'image/jpeg' });
      const stat = await storage.stat(path);
      expect(stat.path).toBe(path);
      expect(stat.size).toBe(8);
      expect(stat.contentType).toBe('image/jpeg');
      expect(stat.lastModified).toBeInstanceOf(Date);
    });

    it('rejects downloads of missing files with a normalized error', async () => {
      await expect(storage.download(`contract/${randomUUID()}/nope.txt`)).rejects.toBeInstanceOf(
        StorageNotFoundError,
      );
    });

    it('deletes files and tolerates deleting them again', async () => {
      const path = track(`contract/${randomUUID()}/gone.txt`);
      await storage.upload(path, 'bye');
      await storage.delete(path);
      expect(await storage.exists(path)).toBe(false);
      await expect(storage.delete(path)).resolves.toBeUndefined();
    });

    it('deleteMany removes every listed path (idempotent, like object stores)', async () => {
      const base = `contract/${randomUUID()}`;
      const kept = track(`${base}/kept.txt`);
      const gone = track(`${base}/gone.txt`);
      await storage.upload(kept, 'a');
      await storage.upload(gone, 'b');

      const result = await storage.deleteMany([kept, gone, `${base}/never-existed.txt`]);
      expect(result.deleted.sort()).toEqual([kept, gone, `${base}/never-existed.txt`].sort());
      expect(result.failed).toHaveLength(0);
      expect(await storage.exists(kept)).toBe(false);
      expect(await storage.exists(`${base}/never-existed.txt`)).toBe(false);
    });

    it('lists files one level deep with directories', async () => {
      const base = `contract/${randomUUID()}`;
      await storage.upload(track(`${base}/a.txt`), 'a');
      await storage.upload(track(`${base}/sub/b.txt`), 'b');

      const page = await storage.list({ prefix: `${base}/` });
      const paths = page.files.map((file) => file.path);
      expect(paths).toContain(`${base}/a.txt`);
      expect(page.files.find((file) => file.path === `${base}/a.txt`)?.size).toBe(1);
      expect(page.directories).toContain(`${base}/sub/`);
      expect(paths).not.toContain(`${base}/sub/b.txt`);
    });

    it('lists recursively and paginates', async () => {
      const base = `contract/${randomUUID()}`;
      for (let i = 0; i < 5; i += 1) {
        await storage.upload(track(`${base}/page/${i}.txt`), String(i));
      }

      const collected: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await storage.list({
          prefix: `${base}/`,
          recursive: true,
          limit: 2,
          ...(cursor !== undefined ? { cursor } : {}),
        });
        collected.push(...page.files.map((file) => file.path));
        cursor = page.cursor;
        pages += 1;
        expect(page.files.length).toBeLessThanOrEqual(2);
      } while (cursor !== undefined && pages < 10);

      expect(pages).toBeGreaterThanOrEqual(3);
      expect(collected).toHaveLength(5);
      expect(new Set(collected).size).toBe(5);
    });

    it('iterates everything under a prefix', async () => {
      const base = `contract/${randomUUID()}`;
      for (let i = 0; i < 4; i += 1) {
        await storage.upload(track(`${base}/it/${i}.txt`), String(i));
      }
      const seen: string[] = [];
      for await (const file of storage.iterate(`${base}/`)) {
        seen.push(file.path);
      }
      expect(seen).toHaveLength(4);
    });

    it('copies server-side when possible', async () => {
      const source = track(`contract/${randomUUID()}/source.txt`);
      const destination = track(`contract/${randomUUID()}/destination.txt`);
      await storage.upload(source, 'copy me');

      const result = await storage.copy(source, destination);
      expect(result.source).toBe(source);
      expect(result.destination).toBe(destination);
      await expect((await storage.download(destination)).text()).resolves.toBe('copy me');
      expect(await storage.exists(source)).toBe(true);
    });

    it('moves files', async () => {
      const source = track(`contract/${randomUUID()}/old.txt`);
      const destination = track(`contract/${randomUUID()}/new.txt`);
      await storage.upload(source, 'moving on');

      const result = await storage.move(source, destination);
      expect(result.destination).toBe(destination);
      expect(await storage.exists(source)).toBe(false);
      await expect((await storage.download(destination)).text()).resolves.toBe('moving on');
    });

    it('honors overwrite: false with a conflict error', async () => {
      const path = track(`contract/${randomUUID()}/clash.txt`);
      await storage.upload(path, 'first');
      await expect(
        storage.upload(path, 'second', { overwrite: false }),
      ).rejects.toBeInstanceOf(StorageConflictError);
      await expect((await storage.download(path)).text()).resolves.toBe('first');
    });

    it('overwrites by default', async () => {
      const path = track(`contract/${randomUUID()}/replace.txt`);
      await storage.upload(path, 'one');
      await storage.upload(path, 'two');
      await expect((await storage.download(path)).text()).resolves.toBe('two');
    });

    it('handles empty files', async () => {
      const path = track(`contract/${randomUUID()}/empty.txt`);
      await storage.upload(path, '');
      const stat = await storage.stat(path);
      expect(stat.size).toBe(0);
      await expect((await storage.download(path)).buffer()).resolves.toEqual(Buffer.alloc(0));
    });

    it('handles unicode and special characters in keys', async () => {
      const path = track(`contract/${randomUUID()}/中文 + file name (1).txt`);
      await storage.upload(path, 'unicode ok');
      expect(await storage.exists(path)).toBe(true);
      await expect((await storage.download(path)).text()).resolves.toBe('unicode ok');
    });

    it('exposes capabilities', () => {
      const capabilities: StorageCapabilities = storage.capabilities();
      expect(typeof capabilities.signedUrls).toBe('boolean');
      expect(typeof capabilities.multipartUpload).toBe('boolean');
      expect(typeof capabilities.serverSideCopy).toBe('boolean');
    });

    it('exposes the native client and nativeRequest', async () => {
      const native = storage.native();
      expect(native).toBeDefined();
      await expect(storage.nativeRequest(async (client) => client)).resolves.toBe(native);
    });

    if (options.capabilities?.signedUrls) {
      it('creates signed URLs with validated expiry', async () => {
        const path = track(`contract/${randomUUID()}/signed.txt`);
        await storage.upload(path, 'secret');
        const url = await storage.getSignedUrl(path, { expiresIn: 60 });
        expect(url).toContain(path.split('/').pop()!);

        expect(
          storage.getSignedUrl(path, { expiresIn: 8 * 24 * 60 * 60 }),
        ).rejects.toBeInstanceOf(StorageError);
      });

      it('creates write signed URLs', async () => {
        const path = `contract/${randomUUID()}/upload-target.txt`;
        uploaded.push(path);
        const url = await storage.getSignedUrl(path, { action: 'write', expiresIn: 60 });
        expect(typeof url).toBe('string');
      });
    }

  });
}

async function result2buffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
