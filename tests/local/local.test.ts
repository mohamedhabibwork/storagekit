import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStorage } from '../../src/factory';
import { defineDriverContractTests } from '../../src/testing/driver-contract';
import { StorageInvalidPathError, StorageUnsupportedOperationError } from '../../src/core/errors';
import type { Storage } from '../../src/core/types';

let root: string;
let storage: Storage<'local'>;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'storagekit-local-'));
  storage = await createStorage({ type: 'local', root, baseUrl: 'https://files.example.com/cdn' });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

defineDriverContractTests({
  name: 'local',
  createStorage: async () => storage,
  capabilities: { signedUrls: false },
});

describe('local driver specifics', () => {
  it('never escapes the configured root', async () => {
    await expect(storage.upload('../../etc/passwd', 'nope')).rejects.toBeInstanceOf(
      StorageInvalidPathError,
    );
    await expect(storage.upload('a/../../b', 'nope')).rejects.toBeInstanceOf(
      StorageInvalidPathError,
    );
    await expect(storage.download('..\\..\\windows\\system32')).rejects.toBeInstanceOf(
      StorageInvalidPathError,
    );
  });

  it('normalizes messy keys', async () => {
    await storage.upload('//double//slashes///x.txt', 'normalized');
    expect(await storage.exists('double/slashes/x.txt')).toBe(true);
    await expect((await storage.download('/double/slashes/x.txt')).text()).resolves.toBe('normalized');
  });

  it('resolves keys against the configured prefix', async () => {
    const prefixed = await createStorage({
      type: 'local',
      root,
      prefix: 'tenant-a/',
    });
    await prefixed.upload('docs/file.txt', 'prefixed!');
    // File physically lives inside the prefix directory
    const raw = await readFile(path.join(root, 'tenant-a', 'docs', 'file.txt'), 'utf8');
    expect(raw).toBe('prefixed!');
    expect(await prefixed.exists('docs/file.txt')).toBe(true);
    expect(await storage.exists('tenant-a/docs/file.txt')).toBe(true);

    const page = await prefixed.list({ prefix: 'docs/' });
    expect(page.files.map((f) => f.path)).toEqual(['docs/file.txt']);
  });

  it('uses move() as a real filesystem rename', async () => {
    const source = path.join(root, 'move-src.txt');
    await writeFile(source, 'moving');
    await storage.move('move-src.txt', 'nested/move-dst.txt');
    await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect((await storage.download('nested/move-dst.txt')).text()).resolves.toBe('moving');
  });

  it('lists actual directories in one-level listings', async () => {
    await mkdir(path.join(root, 'dir-listing', 'child-a'), { recursive: true });
    await mkdir(path.join(root, 'dir-listing', 'child-b'), { recursive: true });
    await writeFile(path.join(root, 'dir-listing', 'root.txt'), 'x');
    await writeFile(path.join(root, 'dir-listing', 'child-a', 'deep.txt'), 'y');

    const page = await storage.list({ prefix: 'dir-listing/' });
    expect(page.files.map((f) => f.path)).toEqual(['dir-listing/root.txt']);
    expect(page.directories.sort()).toEqual(['dir-listing/child-a/', 'dir-listing/child-b/']);
  });

  it('lists and iterates from the root when no prefix is given', async () => {
    await storage.upload('root-file.txt', 'r');
    const page = await storage.list({ limit: 10 });
    expect(page.files.map((f) => f.path)).toContain('root-file.txt');
    const seen: string[] = [];
    for await (const file of storage.iterate()) {
      seen.push(file.path);
    }
    expect(seen).toContain('root-file.txt');
    await storage.delete('root-file.txt');
  });

  it('builds public URLs from baseUrl and file URLs natively', async () => {
    await storage.upload('url/file.bin', 'x');
    expect(await storage.getUrl('url/file.bin')).toBe('https://files.example.com/cdn/url/file.bin');
    const fileUrl = await storage.getUrl('url/file.bin', { native: { fileUrl: true } });
    expect(fileUrl.startsWith('file://')).toBe(true);
  });

  it('rejects signed URLs', async () => {
    await expect(storage.getSignedUrl('anything.txt')).rejects.toBeInstanceOf(
      StorageUnsupportedOperationError,
    );
  });

  it('detects content types from extensions', async () => {
    await storage.upload('mime/report.pdf', '%PDF-1.4');
    const stat = await storage.stat('mime/report.pdf');
    expect(stat.contentType).toBe('application/pdf');
  });
});
