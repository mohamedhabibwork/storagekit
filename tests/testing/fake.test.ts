import { Readable } from 'node:stream';

import { afterAll, describe, expect, it } from 'vitest';

import {
  createStorage,
  listStorageTypes,
  registerStorageDriver,
  unregisterStorageDriver,
  StorageError,
  StorageUnsupportedOperationError,
} from '../../src/index';
import {
  createFakeStorage,
  FakeStorageDriver,
} from '../../src/testing/fake';
import { defineDriverContractTests } from '../../src/testing/driver-contract';

defineDriverContractTests({
  name: 'fake',
  createStorage: () => createFakeStorage({ signedUrls: true, baseUrl: 'https://fake.test' }),
  capabilities: { signedUrls: true },
});

describe('createFakeStorage basics', () => {
  it('stores and reads without any configuration', async () => {
    const storage = await createFakeStorage();
    await storage.upload('a/b.txt', 'hello');
    await expect((await storage.download('a/b.txt')).text()).resolves.toBe('hello');
    expect(storage.type).toBe('fake');
  });

  it('detects content types from extensions, unless disabled', async () => {
    const storage = await createFakeStorage();
    await storage.upload('photo.jpg', Buffer.from('jpeg'));
    expect((await storage.stat('photo.jpg')).contentType).toBe('image/jpeg');

    const blind = await createFakeStorage({}, { detectContentType: false });
    await blind.upload('photo.jpg', Buffer.from('jpeg'));
    expect((await blind.stat('photo.jpg')).contentType).toBeUndefined();
  });

  it('serves fresh streams for buffer(), text() and json()', async () => {
    const storage = await createFakeStorage();
    await storage.upload('data.json', JSON.stringify({ n: 1 }));
    const download = await storage.download('data.json');
    // The stream returned alongside the helpers must not be consumed by them.
    expect(download.stream.readable).toBe(true);
    await expect(download.text()).resolves.toBe(JSON.stringify({ n: 1 }));
    await expect(download.json<{ n: number }>()).resolves.toEqual({ n: 1 });
    const chunks: Buffer[] = [];
    for await (const chunk of download.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString('utf8')).toBe(JSON.stringify({ n: 1 }));
  });

  it('supports stream uploads', async () => {
    const storage = await createFakeStorage();
    await storage.upload('streamed.bin', Readable.from([Buffer.from('abc'), Buffer.from('def')]));
    await expect((await storage.download('streamed.bin')).buffer()).resolves.toEqual(
      Buffer.from('abcdef'),
    );
  });

  it('emits operation events with provider "fake"', async () => {
    const events: string[] = [];
    const storage = await createFakeStorage({}, {
      onOperation: (event) => events.push(`${event.provider}:${event.operation}`),
    });
    await storage.upload('evt.txt', 'x');
    await storage.delete('evt.txt');
    expect(events).toEqual(['fake:upload', 'fake:delete']);
  });
});

describe('fake seeding and reset', () => {
  it('preloads initialFiles with derived content types', async () => {
    const storage = await createFakeStorage({
      initialFiles: { 'seeded/notes.txt': 'seed text', 'seeded/img.png': new Uint8Array([1, 2]) },
    });
    expect(await storage.exists('seeded/notes.txt')).toBe(true);
    await expect((await storage.download('seeded/notes.txt')).text()).resolves.toBe('seed text');
    expect((await storage.stat('seeded/notes.txt')).contentType).toBe('text/plain');
    expect((await storage.stat('seeded/img.png')).size).toBe(2);
  });

  it('seed() accepts stream bodies and preserves existing metadata', async () => {
    const driver = new FakeStorageDriver({ type: 'fake' });

    await driver.upload('meta.txt', 'first', { metadata: { owner: 'test' } });
    await driver.seed({ 'meta.txt': Readable.from(Buffer.from('second')), 'fresh.txt': 'f' });

    const stat = await driver.stat('meta.txt');
    expect(stat.size).toBe(6);
    expect(stat.metadata).toEqual({ owner: 'test' });
    expect(await driver.exists('fresh.txt')).toBe(true);
  });

  it('reset() clears files and queued failures', async () => {
    const driver = new FakeStorageDriver({ type: 'fake' });
    await driver.upload('gone.txt', 'x');
    driver.failOnce('download');
    driver.reset();

    expect(driver.files.size).toBe(0);
    // No queued failure left: downloads of missing files fail as NotFound.
    await expect(driver.download('gone.txt')).rejects.toThrow(/not found/);
  });
});

describe('fake failure injection', () => {
  it('exposes the file table through native()', async () => {
    const storage = await createFakeStorage();
    await storage.upload('flaky.txt', 'stable');
    const native = storage.native() as { files: Map<string, unknown> };
    expect(native.files.has('flaky.txt')).toBe(true);
    await expect(storage.nativeRequest(async (client) => client)).resolves.toBe(native);
  });

  it('surfaces injected errors through the storage wrapper', async () => {
    const driver = new FakeStorageDriver({ type: 'fake' });
    const { StorageInstance } = await import('../../src/storage');
    const storage = new StorageInstance<'fake'>(driver);

    await driver.upload('x.txt', 'x');

    driver.failOnce('download');
    await expect(storage.download('x.txt')).rejects.toBeInstanceOf(StorageError);

    // One-shot: the following call succeeds.
    await expect(storage.download('x.txt')).resolves.toBeTruthy();

    driver.failOnce('upload', new Error('disk on fire'));
    await expect(storage.upload('y.txt', 'y')).rejects.toThrow('disk on fire');
    expect(await driver.exists('y.txt')).toBe(false);
  });

  it('clearFailures() cancels queued failures', async () => {
    const driver = new FakeStorageDriver({ type: 'fake' });
    await driver.upload('keep.txt', 'keep');
    driver.failOnce('delete');
    driver.clearFailures();
    await expect(driver.delete('keep.txt')).resolves.toBeUndefined();
  });
});

describe('fake latency', () => {
  it('delays each data operation by latencyMs', async () => {
    const storage = await createFakeStorage({ latencyMs: 25 });
    const started = Date.now();
    await storage.upload('slow.txt', 'x');
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });
});

describe('fake URLs', () => {
  it('builds URLs from baseUrl', async () => {
    const storage = await createFakeStorage({ baseUrl: 'https://cdn.test/v1/' });
    await expect(storage.getUrl('a b.txt')).resolves.toBe('https://cdn.test/v1/a b.txt');
  });

  it('rejects getUrl without baseUrl', async () => {
    const storage = await createFakeStorage();
    await expect(storage.getUrl('x.txt')).rejects.toBeInstanceOf(StorageUnsupportedOperationError);
  });

  it('serves deterministic signed URLs when enabled', async () => {
    const storage = await createFakeStorage({ signedUrls: true, baseUrl: 'https://fake.test' });
    expect(storage.capabilities().signedUrls).toBe(true);

    const url = await storage.getSignedUrl('dir/file.txt', { expiresIn: 60 });
    expect(url).toContain('file.txt');
    expect(url).toContain('X-Fake-Signature=');
    expect(url).toMatch(/^https:\/\/fake\.test\//);

    const again = await storage.getSignedUrl('dir/file.txt', { expiresIn: 60 });
    expect(again).toBe(url);

    const writeUrl = await storage.getSignedUrl('dir/file.txt', { action: 'write', expiresIn: 60 });
    expect(writeUrl).toContain('X-Fake-Action=write');
    expect(writeUrl).not.toBe(url);
  });

  it('caps signed URL expiry at 7 days and rejects when disabled', async () => {
    const storage = await createFakeStorage({ signedUrls: true });
    await expect(
      storage.getSignedUrl('x.txt', { expiresIn: 8 * 24 * 60 * 60 }),
    ).rejects.toBeInstanceOf(StorageError);

    const disabled = await createFakeStorage();
    expect(disabled.capabilities().signedUrls).toBe(false);
    await expect(disabled.getSignedUrl('x.txt')).rejects.toBeInstanceOf(
      StorageUnsupportedOperationError,
    );
  });
});

describe('fake through the custom driver registry', () => {
  afterAll(() => {
    unregisterStorageDriver('fake-registry');
  });

  it('registers like any custom driver and resolves via createStorage', async () => {
    expect(listStorageTypes()).not.toContain('fake');
    registerStorageDriver('fake-registry', (config) => new FakeStorageDriver(config as never));

    const storage = await createStorage({
      type: 'fake-registry',
      baseUrl: 'https://mem.test',
    } as never);
    expect(storage.type).toBe('fake'); // driver's declared type, not the registry lookup key
    await storage.upload('via-registry.txt', 'works');
    await expect((await storage.download('via-registry.txt')).text()).resolves.toBe('works');
    await expect(storage.getUrl('via-registry.txt')).resolves.toBe(
      'https://mem.test/via-registry.txt',
    );
  });
});
