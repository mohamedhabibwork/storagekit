import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  StorageConflictError,
  StorageError,
  StorageNotFoundError,
  StorageUnsupportedOperationError,
} from '../core/errors';
import { detectContentTypeFromPath } from '../core/mime';
import { normalizeKey } from '../core/paths';
import { bodyToReadable, streamToBuffer } from '../core/streams';
import type {
  OperationListener,
  StorageHooks,
  UploadBody,
} from '../core/primitives';
import type {
  CopyOptions,
  DownloadResult,
  FileStat,
  ListOptions,
  ListResult,
  MoveOptions,
  SignedUrlOptions,
  Storage,
  UploadOptions,
  UploadResult,
} from '../core/types';
import type { StorageDriver } from '../drivers/driver';
import { StorageInstance } from '../storage';

/**
 * In-memory fake driver for tests: no SDKs, no network, no filesystem —
 * yet it passes the same behavioral contract as the real providers
 * (`defineDriverContractTests`). Import from `storagekit/testing/fake`.
 *
 * Beyond the storage contract it ships the knobs test suites actually
 * need: seed files at construction, reset between tests, one-shot failure
 * injection per operation, simulated latency, and optional fake signed
 * URLs.
 */

export interface FakeStoredFile {
  data: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
  lastModified: Date;
}

export interface FakeStorageConfig {
  type: 'fake';
  /** Base URL used by `getUrl()` and fake signed URLs. */
  baseUrl?: string;
  /** Files preloaded at construction, keyed by path. */
  initialFiles?: Record<string, string | Uint8Array>;
  /** Simulated latency applied to every data operation, in milliseconds. */
  latencyMs?: number;
  /** Advertise `signedUrls` capability and serve fake signed URLs. */
  signedUrls?: boolean;
}

export type FakeStorageOptions = Omit<FakeStorageConfig, 'type'>;

/** Operations that can be failed once via {@link FakeStorageDriver.failOnce}. */
export type FakeFailureOperation =
  | 'upload'
  | 'download'
  | 'delete'
  | 'deleteMany'
  | 'exists'
  | 'stat'
  | 'list'
  | 'copy'
  | 'move';

export class FakeStorageDriver implements StorageDriver<'fake'> {
  readonly type = 'fake' as const;

  /** Live file table — assert against it directly in tests. */
  readonly files = new Map<string, FakeStoredFile>();

  private readonly baseUrl?: string;
  private readonly latencyMs: number;
  private readonly signedUrlsEnabled: boolean;
  private readonly detectContentType: boolean;
  private readonly failures = new Map<FakeFailureOperation, Error>();
  private nativeClient: { files: Map<string, FakeStoredFile> } | undefined;

  constructor(
    config: FakeStorageConfig,
    runtime?: { detectContentType?: boolean },
  ) {
    this.baseUrl = config.baseUrl;
    this.latencyMs = Math.max(0, config.latencyMs ?? 0);
    this.signedUrlsEnabled = config.signedUrls ?? false;
    this.detectContentType = runtime?.detectContentType !== false;
    for (const [path, body] of Object.entries(config.initialFiles ?? {})) {
      const key = normalizeKey(path);
      this.files.set(key, {
        data: Buffer.from(body),
        contentType: this.detectContentType ? detectContentTypeFromPath(path) : undefined,
        lastModified: new Date(),
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Test-support API (not part of StorageDriver)
   * ------------------------------------------------------------------ */

  /** Preload files after construction. Bodies may be any UploadBody. */
  async seed(entries: Record<string, UploadBody>): Promise<void> {
    for (const [path, body] of Object.entries(entries)) {
      const key = normalizeKey(path);
      const data = await this.toBuffer(body);
      const existing = this.files.get(key);
      this.files.set(key, {
        data,
        contentType:
          existing?.contentType ??
          (this.detectContentType ? detectContentTypeFromPath(path) : undefined),
        metadata: existing?.metadata,
        lastModified: new Date(),
      });
    }
  }

  /** Drop every file and queued failure. */
  reset(): void {
    this.files.clear();
    this.failures.clear();
  }

  /**
   * Make the next call to `operation` fail. Defaults to a generic
   * StorageError; pass any error to simulate provider-specific failures.
   */
  failOnce(operation: FakeFailureOperation, error?: Error): void {
    this.failures.set(
      operation,
      error ?? new StorageError(`fake storage: simulated ${operation} failure`, {
        provider: 'fake',
        operation,
        code: 'FAKE_FAILURE',
      }),
    );
  }

  /** Remove every queued failure without touching stored files. */
  clearFailures(): void {
    this.failures.clear();
  }

  /* ------------------------------------------------------------------ *
   * StorageDriver implementation
   * ------------------------------------------------------------------ */

  native() {
    if (!this.nativeClient) {
      this.nativeClient = { files: this.files };
    }
    return this.nativeClient;
  }

  nativeRequest<R>(fn: (client: { files: Map<string, FakeStoredFile> }) => Promise<R>): Promise<R> {
    return fn(this.native());
  }

  capabilities() {
    return {
      signedUrls: this.signedUrlsEnabled,
      multipartUpload: true,
      serverSideCopy: true,
      versioning: false,
      metadata: true,
      directories: false,
      bulkDelete: false,
    };
  }

  async upload(
    path: string,
    body: UploadBody,
    options: UploadOptions<'fake'> = {},
  ): Promise<UploadResult<'fake'>> {
    this.injectFailure('upload', path);
    await this.tick();
    const key = normalizeKey(path);
    if (options.overwrite === false && this.files.has(key)) {
      throw new StorageConflictError(`"${path}" already exists`, {
        provider: 'fake',
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
        (this.detectContentType ? detectContentTypeFromPath(path) : undefined),
      metadata: options.metadata ?? existing?.metadata,
      lastModified: new Date(),
    });
    return { path: key, size: data.length, provider: 'fake' };
  }

  async download(path: string): Promise<DownloadResult<'fake'>> {
    this.injectFailure('download', path);
    await this.tick();
    const file = this.files.get(normalizeKey(path));
    if (!file) {
      throw new StorageNotFoundError(`"${path}" not found`, { provider: 'fake', path });
    }
    // buffer()/text()/json() each read from a fresh stream so callers can
    // mix them freely without competing for the same stream.
    return {
      stream: Readable.from(file.data),
      contentType: file.contentType,
      contentLength: file.data.length,
      lastModified: file.lastModified,
      metadata: file.metadata,
      provider: 'fake',
      buffer: () => streamToBuffer(Readable.from(file.data)),
      text: () => streamToBuffer(Readable.from(file.data)).then((b) => b.toString('utf8')),
      json: <V>() => streamToBuffer(Readable.from(file.data)).then((b) => JSON.parse(b.toString('utf8')) as V),
    };
  }

  async delete(path: string): Promise<void> {
    this.injectFailure('delete', path);
    await this.tick();
    this.remove(path);
  }

  async deleteMany(paths: string[]): Promise<{
    deleted: string[];
    failed: Array<{ path: string; error: unknown }>;
  }> {
    this.injectFailure('deleteMany');
    await this.tick();
    const deleted: string[] = [];
    const failed: Array<{ path: string; error: unknown }> = [];
    for (const path of paths) {
      try {
        this.remove(path);
        deleted.push(path);
      } catch (error) {
        failed.push({ path, error });
      }
    }
    return { deleted, failed };
  }

  async exists(path: string): Promise<boolean> {
    this.injectFailure('exists', path);
    await this.tick();
    return this.files.has(normalizeKey(path));
  }

  async stat(path: string): Promise<FileStat<'fake'>> {
    this.injectFailure('stat', path);
    await this.tick();
    const file = this.files.get(normalizeKey(path));
    if (!file) {
      throw new StorageNotFoundError(`"${path}" not found`, { provider: 'fake', path });
    }
    return {
      path: normalizeKey(path),
      size: file.data.length,
      contentType: file.contentType,
      lastModified: file.lastModified,
      metadata: file.metadata,
      provider: 'fake',
    };
  }

  async list(options: ListOptions<'fake'> = {}): Promise<ListResult<'fake'>> {
    this.injectFailure('list');
    await this.tick();
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

    return { files, directories, cursor: hasMore ? cursor : undefined, hasMore };
  }

  async copy(
    source: string,
    destination: string,
    options: CopyOptions<'fake'> = {},
  ): Promise<{ source: string; destination: string }> {
    this.injectFailure('copy', source);
    await this.tick();
    const src = this.files.get(normalizeKey(source));
    if (!src) {
      throw new StorageNotFoundError(`"${source}" not found`, { provider: 'fake', path: source });
    }
    if (options.overwrite === false && this.files.has(normalizeKey(destination))) {
      throw new StorageConflictError(`"${destination}" already exists`, {
        provider: 'fake',
        path: destination,
      });
    }
    const copy: FakeStoredFile = { ...src, lastModified: new Date() };
    if (options.contentType !== undefined) copy.contentType = options.contentType;
    if (options.metadata !== undefined) copy.metadata = options.metadata;
    this.files.set(normalizeKey(destination), copy);
    return { source, destination };
  }

  async move(
    source: string,
    destination: string,
    options: MoveOptions<'fake'> = {},
  ): Promise<{ source: string; destination: string }> {
    this.injectFailure('move', source);
    await this.tick();
    await this.copy(source, destination, options);
    this.remove(source);
    return { source, destination };
  }

  async getUrl(path: string): Promise<string> {
    if (!this.baseUrl) {
      throw new StorageUnsupportedOperationError('fake driver needs a `baseUrl` for getUrl()', {
        provider: 'fake',
        path,
      });
    }
    return `${this.baseUrl.replace(/\/+$/, '')}/${path}`;
  }

  async getSignedUrl(path: string, options: SignedUrlOptions<'fake'> = {}): Promise<string> {
    if (!this.signedUrlsEnabled) {
      throw new StorageUnsupportedOperationError(
        'fake signed URLs are disabled; pass `signedUrls: true` to the config',
        { provider: 'fake', path },
      );
    }
    const expiresIn = options.expiresIn ?? 3600;
    if (expiresIn > 7 * 24 * 60 * 60) {
      throw new StorageError('signed URL expiry is capped at 7 days', {
        provider: 'fake',
        path,
      });
    }
    const action = options.action ?? 'read';
    const base = (this.baseUrl ?? 'https://fake.test').replace(/\/+$/, '');
    const signature = createHash('sha256')
      .update(`${action}:${normalizeKey(path)}:${expiresIn}`)
      .digest('hex')
      .slice(0, 32);
    return `${base}/${path}?X-Fake-Action=${action}&X-Fake-Expires=${expiresIn}&X-Fake-Signature=${signature}`;
  }

  /* ------------------------------------------------------------------ *
   * Internals
   * ------------------------------------------------------------------ */

  private remove(path: string): void {
    // Deleting a missing key is a no-op: object stores treat delete as
    // idempotent and the contract suite relies on that.
    this.files.delete(normalizeKey(path));
  }

  private injectFailure(operation: FakeFailureOperation, _path?: string): void {
    const error = this.failures.get(operation);
    if (!error) return;
    this.failures.delete(operation);
    throw error;
  }

  private async tick(): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
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
}

export interface CreateFakeStorageOptions {
  hooks?: StorageHooks;
  onOperation?: OperationListener;
  /** Disable extension-based MIME detection for implicit content types. */
  detectContentType?: boolean;
}

/**
 * Create a fully working in-memory `Storage` for tests — the fake twin of
 * `createStorage()`. No registration, no SDKs, no I/O.
 *
 * ```ts
 * import { createFakeStorage } from '@mohamedhabibwork/storagekit/testing/fake';
 *
 * const storage = await createFakeStorage({ signedUrls: true });
 * await storage.upload('greetings.txt', 'hello');
 * ```
 *
 * To resolve the fake through config-driven code paths, register it as a
 * custom driver instead:
 *
 * ```ts
 * registerStorageDriver('fake', (config) => new FakeStorageDriver(config as never));
 * const storage = await createStorage({ type: 'fake' });
 * ```
 */
export async function createFakeStorage(
  config: FakeStorageOptions = {},
  options: CreateFakeStorageOptions = {},
): Promise<Storage<'fake'>> {
  const driver = new FakeStorageDriver(
    { type: 'fake', ...config },
    { detectContentType: options.detectContentType },
  );
  return new StorageInstance<'fake'>(driver, {
    hooks: options.hooks,
    onOperation: options.onOperation,
  });
}
