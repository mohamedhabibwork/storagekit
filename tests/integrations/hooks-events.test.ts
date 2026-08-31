import { afterAll, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';

import { createStorage } from '../../src/factory';
import type { Storage, StorageOperationEvent } from '../../src/core/types';

afterAll(async () => {
  await Promise.all(
    ['.tmp-hooks', '.tmp-events'].map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('hooks', () => {
  it('runs before/after hooks around operations and reports errors', async () => {
    const calls: string[] = [];
    const storage = await createStorage(
      { type: 'local', root: './.tmp-hooks' },
      {
        hooks: {
          beforeUpload: (ctx) => {
            calls.push(`before:${ctx.operation}:${ctx.path}`);
          },
          afterUpload: (ctx) => {
            calls.push(`after:${ctx.operation}`);
          },
          beforeDownload: (ctx) => {
            calls.push(`before:${ctx.operation}`);
          },
          afterDownload: (ctx) => {
            calls.push(`after:${ctx.operation}`);
          },
          beforeDelete: (ctx) => {
            calls.push(`before:${ctx.operation}`);
          },
          afterDelete: (ctx) => {
            calls.push(`after:${ctx.operation}`);
          },
          downloadError: (ctx) => {
            calls.push(`error:${ctx.operation}`);
          },
        },
      },
    );

    await storage.upload('hooked.txt', 'data');
    await storage.download('hooked.txt');
    await storage.delete('hooked.txt');
    await expect(storage.download('missing.txt')).rejects.toThrow();

    expect(calls).toEqual([
      'before:upload:hooked.txt',
      'after:upload',
      'before:download',
      'after:download',
      'before:delete',
      'after:delete',
      'before:download',
      'error:download',
    ]);
  });
});

describe('events', () => {
  it('emits normalized operation events with durations', async () => {
    const storage: Storage<'local'> = await createStorage({ type: 'local', root: './.tmp-events' });
    const events: StorageOperationEvent[] = [];
    storage.on('operation', (event) => events.push(event));

    await storage.upload('evented.txt', 'x');
    await storage.stat('evented.txt');
    await storage.delete('evented.txt');

    expect(events.map((e) => e.operation)).toEqual(['upload', 'stat', 'delete']);
    expect(events.every((e) => e.success)).toBe(true);
    expect(events.every((e) => e.duration >= 0)).toBe(true);
    expect(events[0]?.path).toBe('evented.txt');
    expect(events.every((e) => e.provider === 'local')).toBe(true);
  });
});
