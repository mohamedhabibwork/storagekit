import { Readable } from 'node:stream';

import { afterAll, describe, expect, it } from 'vitest';

import {
  createStorage,
  defineDriver,
  listStorageTypes,
  registerStorageDriver,
  unregisterStorageDriver,
  StorageConflictError,
  StorageInvalidConfigError,
  StorageNotFoundError,
  StorageUnsupportedOperationError,
} from '../../src/index';
import { normalizeKey } from '../../src/core/paths';
import { bodyToReadable, streamToBuffer } from '../../src/core/streams';
import type { UploadBody } from '../../src/core/types';
import type { StorageDriver } from '../../src/drivers/driver';
import { defineDriverContractTests } from '../../src/testing/driver-contract';
import type { Storage } from '../../src/core/types';

/**
 * A complete custom driver built against the public API: an in-memory
 * store registered as type 'memory'. Proves the registry works end to end
 * and that custom drivers can pass the same contract suite as builtins.
 */

interface MemoryConfig {
  type: 'memory';
  baseUrl?: string;
}

interface StoredFile {
  data: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
  lastModified: Date;
}

class MemoryDriver implements StorageDriver<'memory'> {
  readonly type = 'memory' as const;

  readonly files = new Map<string, StoredFile>();
  private isReady = false;
  private nativeClient: { files: Map<string, StoredFile>; ready: boolean } | undefined;

  constructor(
    private readonly config: MemoryConfig,
    runtime?: { detectContentType?: boolean },
  ) {
    void runtime;
  }

  /** Optional async init — the factory awaits this. */
  async ready(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.isReady = true;
  }

  private assertReady(): void {
    if (!this.isReady) throw new Error('driver not ready');
  }

  private key(path: string): string {
    return normalizeKey(path);
  }

  native() {
    if (!this.nativeClient) {
      this.nativeClient = { files: this.files, ready: this.isReady };
    }
    return this.nativeClient;
  }

  nativeRequest<R>(fn: (client: unknown) => Promise<R>): Promise<R> {
    return fn(this.native());
  }

  capabilities() {
    return {
      signedUrls: false,
      multipartUpload: true,
      serverSideCopy: true,
      versioning: false,
      metadata: true,
      directories: false,
      bulkDelete: false,
    };
  }

  private async toBuffer(body: UploadBody): Promise<Buffer> {
    if (typeof body === 'string') return Buffer.from(body, 'utf8');
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (body instanceof ArrayBuffer) return Buffer.from(body);
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      return Buffer.from(await body.arrayBuffer());
    }
    return streamToBuffer(bodyToReadable(body));
  }

  async upload(path: string, body: UploadBody, options: any = {}) {
    this.assertReady();
    const key = this.key(path);
    if (options.overwrite === false && this.files.has(key)) {
      throw new StorageConflictError(`"${path}" already exists`, {
        provider: 'memory',
        path,
      });
    }
    const data = await this.toBuffer(body);
    const existing = this.files.get(key);
    this.files.set(key, {
      data,
      contentType:
        options.contentType ??
        existing?.contentType ??
        detectContentType(path),
      metadata: options.metadata ?? existing?.metadata,
      lastModified: new Date(),
    });
    return { path, size: data.length, provider: 'memory' as const };
  }

  async download(path: string) {
    this.assertReady();
    const file = this.files.get(this.key(path));
    if (!file) throw new StorageNotFoundError(`"${path}" not found`, { provider: 'memory', path });
    const stream = Readable.from(file.data);
    return {
      stream,
      contentType: file.contentType,
      contentLength: file.data.length,
      lastModified: file.lastModified,
      metadata: file.metadata,
      provider: 'memory' as const,
      buffer: () => streamToBuffer(stream),
      text: () => streamToBuffer(stream).then((b) => b.toString('utf8')),
      json: <V,>() => streamToBuffer(stream).then((b) => JSON.parse(b.toString('utf8')) as V),
    } as never;
  }

  async delete(path: string): Promise<void> {
    this.assertReady();
    this.files.delete(this.key(path));
  }

  async deleteMany(paths: string[]) {
    const deleted: string[] = [];
    const failed: Array<{ path: string; error: unknown }> = [];
    for (const path of paths) {
      try {
        await this.delete(path);
        deleted.push(path);
      } catch (error) {
        failed.push({ path, error });
      }
    }
    return { deleted, failed };
  }

  async exists(path: string): Promise<boolean> {
    this.assertReady();
    return this.files.has(this.key(path));
  }

  async stat(path: string) {
    this.assertReady();
    const file = this.files.get(this.key(path));
    if (!file) throw new StorageNotFoundError(`"${path}" not found`, { provider: 'memory', path });
    return {
      path,
      size: file.data.length,
      contentType: file.contentType,
      lastModified: file.lastModified,
      metadata: file.metadata,
      provider: 'memory' as const,
    } as never;
  }

  async list(options: any = {}) {
    this.assertReady();
    const limit = Math.max(1, options.limit ?? 1000);
    const recursive = options.recursive ?? false;
    const prefix = options.prefix ?? '';

    // Collect sorted entries: files as their full key, directories as key+'/'.
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (recursive || slash === -1) {
        names.add(key);
      } else {
        names.add(`${prefix}${rest.slice(0, slash + 1)}`);
      }
    }

    const sorted = [...names].sort();
    const files: Array<{ path: string; size?: number; lastModified?: Date; metadata?: Record<string, string> }> = [];
    const directories: string[] = [];
    let cursor: string | undefined;
    let hasMore = false;
    let emitted = 0;

    for (const name of sorted) {
      if (options.cursor !== undefined && name <= options.cursor) continue;
      if (emitted >= limit) {
        hasMore = true;
        break;
      }
      emitted += 1;
      cursor = name;
      if (name.endsWith('/')) {
        directories.push(name);
      } else {
        const file = this.files.get(name)!;
        files.push({
          path: name,
          size: file.data.length,
          lastModified: file.lastModified,
          metadata: file.metadata,
        });
      }
    }

    return {
      files,
      directories,
      cursor: hasMore ? cursor : undefined,
      hasMore,
    };
  }

  async copy(source: string, destination: string, options: any = {}) {
    const src = this.files.get(this.key(source));
    if (!src) throw new StorageNotFoundError(`"${source}" not found`, { provider: 'memory', path: source });
    if (options.overwrite === false && this.files.has(this.key(destination))) {
      throw new StorageConflictError(`"${destination}" already exists`, {
        provider: 'memory',
        path: destination,
      });
    }
    const copy: StoredFile = { ...src, lastModified: new Date() };
    if (options.contentType !== undefined) copy.contentType = options.contentType;
    if (options.metadata !== undefined) copy.metadata = options.metadata;
    this.files.set(this.key(destination), copy);
    return { source, destination };
  }

  async move(source: string, destination: string, options: any = {}) {
    await this.copy(source, destination, options);
    await this.delete(source);
    return { source, destination };
  }

  async getUrl(path: string) {
    if (!this.config.baseUrl) {
      throw new StorageUnsupportedOperationError('memory driver needs baseUrl');
    }
    return `${this.config.baseUrl.replace(/\/+$/, '')}/${path}`;
  }

  async getSignedUrl(): Promise<string> {
    throw new StorageUnsupportedOperationError('memory driver has no signed URLs');
  }
}

function detectContentType(path: string): string | undefined {
  const dot = path.lastIndexOf('.');
  return dot > 0 && path.slice(dot + 1) === 'jpg' ? 'image/jpeg' : undefined;
}

// File-level: runs after ALL tests (the contract suite needs the
// registration alive until the end).
afterAll(() => {
  unregisterStorageDriver('memory');
});

describe('custom driver registry', () => {
  it('registers a custom driver and lists it alongside builtins', () => {
    expect(listStorageTypes()).toEqual(['local', 's3', 'minio', 'azure', 'oracle', 'rustfs']);
    registerStorageDriver('memory', (config) => new MemoryDriver(config as MemoryConfig));
    expect(listStorageTypes()).toContain('memory');
    expect(() =>
      registerStorageDriver('memory', () => new MemoryDriver({ type: 'memory' })),
    ).toThrow(StorageInvalidConfigError);
    expect(() => registerStorageDriver('s3', () => new MemoryDriver({ type: 'memory' }))).toThrow(
      StorageInvalidConfigError,
    );
  });

  it('rejects createStorage for unregistered custom types', async () => {
    await expect(createStorage({ type: 'nope-driver' } as never)).rejects.toThrow(
      /registerStorageDriver/,
    );
  });

  it('creates the custom storage and awaits its async ready()', async () => {
    const storage = await createStorage({ type: 'memory', baseUrl: 'https://mem.test' });
    expect(storage.type).toBe('memory');
    // ready() is awaited by the factory before first use
    await expect(storage.upload('ready.txt', 'x')).resolves.toBeTruthy();
    await storage.delete('ready.txt');
  });

  it('keeps native slots as unknown for custom types', async () => {
    const storage: Storage<'memory'> = await createStorage({ type: 'memory' });
    const native = storage.native() as { files: Map<string, unknown> };
    expect(native.files).toBeInstanceOf(Map);
    await expect(storage.nativeRequest(async (client) => client)).resolves.toBe(native);
  });

  it('supports full custom config shapes', async () => {
    const storage = await createStorage({ type: 'memory', baseUrl: 'https://mem.test' });
    await storage.upload('x.txt', 'x');
    expect(await storage.getUrl('x.txt')).toBe('https://mem.test/x.txt');
    await storage.delete('x.txt');
  });
});

// The registered custom driver must pass the same contract suite as the
// builtin providers.
defineDriverContractTests({
  name: 'memory (custom)',
  createStorage: () => createStorage({ type: 'memory' }),
  capabilities: { signedUrls: false },
});

// Silence unused warnings for helpers used inside the driver only.
void defineDriver;
