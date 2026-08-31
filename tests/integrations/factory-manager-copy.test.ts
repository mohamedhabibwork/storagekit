import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';

import { createStorage } from '../../src/factory';
import { createStorageManager } from '../../src/manager';
import { copyBetween } from '../../src/copy-between';
import { StorageInvalidConfigError, StorageInvalidPathError } from '../../src/core/errors';
import type { Storage } from '../../src/core/types';

afterAll(async () => {
  await Promise.all(
    ['.tmp-test-disk', '.tmp-copy-src', '.tmp-copy-dst'].map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe('factory validation', () => {
  it('rejects unknown storage types', async () => {
    await expect(
      createStorage({ type: 'ftp' } as never),
    ).rejects.toBeInstanceOf(StorageInvalidConfigError);
  });

  it('rejects incomplete configs', async () => {
    await expect(createStorage({ type: 'local' } as never)).rejects.toBeInstanceOf(
      StorageInvalidConfigError,
    );
    await expect(createStorage({ type: 's3' } as never)).rejects.toBeInstanceOf(
      StorageInvalidConfigError,
    );
    await expect(createStorage({ type: 'azure', container: 'x' } as never)).rejects.toBeInstanceOf(
      StorageInvalidConfigError,
    );
    await expect(
      createStorage({ type: 'oracle', namespaceName: 'ns' } as never),
    ).rejects.toBeInstanceOf(StorageInvalidConfigError);
    await expect(
      createStorage({ type: 'local', root: 'x', prefix: '../escape' } as never),
    ).rejects.toBeInstanceOf(StorageInvalidPathError);
  });
});

describe('storage manager', () => {
  it('creates and caches disks by name', async () => {
    const manager = createStorageManager({
      default: 'temp',
      disks: {
        temp: { type: 'local', root: './.tmp-test-disk' },
      },
    });

    const disk = await manager.disk('temp');
    expect(disk.type).toBe('local');
    expect(await manager.disk('temp')).toBe(disk);
    expect((await manager.defaultDisk()).type).toBe('local');
    expect(manager.diskNames()).toEqual(['temp']);
    expect(manager.defaultDiskName()).toBe('temp');

    await expect(manager.disk('nope' as never)).rejects.toThrow(/Unknown storage disk/);
    await disk.delete('.tmp-file.txt').catch(() => undefined);
  });
});

describe('copyBetween', () => {
  it('streams content from one local root to another', async () => {
    const mkStorage = async (root: string): Promise<Storage<'local'>> =>
      createStorage({ type: 'local', root });

    const source = await mkStorage('./.tmp-copy-src');
    const target = await mkStorage('./.tmp-copy-dst');

    await source.upload('docs/report.pdf', Buffer.alloc(512 * 1024, 9), {
      contentType: 'application/pdf',
      metadata: { owner: '42' },
    });

    const progresses: number[] = [];
    const result = await copyBetween(source, 'docs/report.pdf', target, 'archive/report.pdf', {
      onProgress: (bytes) => progresses.push(bytes),
    });

    expect(result.path).toBe('archive/report.pdf');
    expect(result.size).toBe(512 * 1024);
    const stat = await target.stat('archive/report.pdf');
    expect(stat.size).toBe(512 * 1024);
    expect(stat.contentType).toBe('application/pdf');
    // Local storage cannot persist metadata, so only size/content-type are
    // asserted here; cloud drivers round-trip metadata.
    expect(progresses[progresses.length - 1]).toBe(512 * 1024);

    const sha = (p: string) =>
      createHash('sha256').update(readFileSync(p)).digest('hex');
    expect(sha('./.tmp-copy-dst/archive/report.pdf')).toBe(
      sha('./.tmp-copy-src/docs/report.pdf'),
    );

    await source.delete('docs/report.pdf');
    await target.delete('archive/report.pdf');
  });
});
