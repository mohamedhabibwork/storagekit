import { StorageError, isStorageError, normalizeError } from './core/errors';
import type {
  CopyOptions,
  CopyResult,
  DeleteManyOptions,
  DeleteManyResult,
  DeleteOptions,
  DownloadOptions,
  DownloadResult,
  ExistsOptions,
  FileStat,
  ListOptions,
  ListResult,
  MoveOptions,
  OperationListener,
  SignedUrlOptions,
  StatOptions,
  Storage,
  StorageCapabilities,
  StorageFile,
  StorageHooks,
  StorageOperationEvent,
  StorageType,
  UploadBody,
  UploadOptions,
  UploadResult,
  UrlOptions,
} from './core/types';
import type { MapValueFor, NativeClientMap } from './core/maps';
import type { StorageDriver } from './drivers/driver';

export interface StorageInstanceOptions {
  hooks?: StorageHooks;
  onOperation?: OperationListener;
}



/**
 * Wraps a driver with the public `Storage<T>` behavior: lifecycle hooks,
 * operation events, and a final error-normalization safety net.
 */
export class StorageInstance<T extends string> implements Storage<T> {
  readonly type: T;
  readonly hooks: StorageHooks;

  private readonly driver: StorageDriver<T>;
  private readonly listeners = new Set<OperationListener>();
  private nativeCache: unknown;

  constructor(driver: StorageDriver<T>, options: StorageInstanceOptions = {}) {
    this.driver = driver;
    this.type = driver.type;
    this.hooks = options.hooks ?? {};
    if (options.onOperation) this.listeners.add(options.onOperation);
  }

  on(_event: 'operation', listener: OperationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(
    operation: string,
    path: string | undefined,
    startedAt: number,
    success: boolean,
    error?: unknown,
  ): void {
    if (this.listeners.size === 0) return;
    const event: StorageOperationEvent = {
      provider: this.type,
      operation,
      ...(path !== undefined ? { path } : {}),
      duration: Date.now() - startedAt,
      success,
      ...(error !== undefined ? { error } : {}),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* listeners must never break storage operations */
      }
    }
  }

  private normalize(thrown: unknown, operation: string, path?: string): never {
    if (isStorageError(thrown)) throw thrown;
    throw normalizeError(thrown, {
      provider: this.type,
      operation,
      path,
    });
  }

  async upload(
    path: string,
    body: UploadBody,
    options: UploadOptions<T> = {},
  ): Promise<UploadResult<T>> {
    const startedAt = Date.now();
    const ctx = { operation: 'upload' as const, path, startedAt };
    try {
      await this.hooks.beforeUpload?.(ctx);
      const result = await this.driver.upload(path, body, options);
      await this.hooks.afterUpload?.(ctx);
      this.emit('upload', path, startedAt, true);
      return result;
    } catch (error) {
      this.emit('upload', path, startedAt, false, error);
      try {
        await this.hooks.uploadError?.({ ...ctx, error });
      } catch {
        /* hook errors never mask the original failure */
      }
      this.normalize(error, 'upload', path);
    }
  }

  async download(
    path: string,
    options: DownloadOptions<T> = {},
  ): Promise<DownloadResult<T>> {
    const startedAt = Date.now();
    const ctx = { operation: 'download' as const, path, startedAt };
    try {
      await this.hooks.beforeDownload?.(ctx);
      const result = await this.driver.download(path, options);
      await this.hooks.afterDownload?.(ctx);
      this.emit('download', path, startedAt, true);
      return result;
    } catch (error) {
      this.emit('download', path, startedAt, false, error);
      try {
        await this.hooks.downloadError?.({ ...ctx, error });
      } catch {
        /* hook errors never mask the original failure */
      }
      this.normalize(error, 'download', path);
    }
  }

  async delete(path: string, options: DeleteOptions<T> = {}): Promise<void> {
    const startedAt = Date.now();
    const ctx = { operation: 'delete' as const, path, startedAt };
    try {
      await this.hooks.beforeDelete?.(ctx);
      await this.driver.delete(path, options);
      await this.hooks.afterDelete?.(ctx);
      this.emit('delete', path, startedAt, true);
    } catch (error) {
      this.emit('delete', path, startedAt, false, error);
      try {
        await this.hooks.deleteError?.({ ...ctx, error });
      } catch {
        /* hook errors never mask the original failure */
      }
      this.normalize(error, 'delete', path);
    }
  }

  async deleteMany(
    paths: string[],
    options: DeleteManyOptions<T> = {},
  ): Promise<DeleteManyResult> {
    const startedAt = Date.now();
    try {
      const result = await this.driver.deleteMany(paths, options);
      this.emit('deleteMany', undefined, startedAt, true);
      return {
        deleted: result.deleted,
        failed: result.failed.map((entry) => ({
          path: entry.path,
          error: isStorageError(entry.error)
            ? entry.error
            : normalizeError(entry.error, {
                provider: this.type,
                operation: 'deleteMany',
                path: entry.path,
              }),
        })),
      };
    } catch (error) {
      this.emit('deleteMany', undefined, startedAt, false, error);
      this.normalize(error, 'deleteMany');
    }
  }

  async exists(path: string, options: ExistsOptions<T> = {}): Promise<boolean> {
    const startedAt = Date.now();
    try {
      const result = await this.driver.exists(path, options);
      this.emit('exists', path, startedAt, true);
      return result;
    } catch (error) {
      this.emit('exists', path, startedAt, false, error);
      this.normalize(error, 'exists', path);
    }
  }

  async stat(path: string, options: StatOptions<T> = {}): Promise<FileStat<T>> {
    const startedAt = Date.now();
    try {
      const result = await this.driver.stat(path, options);
      this.emit('stat', path, startedAt, true);
      return result;
    } catch (error) {
      this.emit('stat', path, startedAt, false, error);
      this.normalize(error, 'stat', path);
    }
  }

  async list(options: ListOptions<T> = {}): Promise<ListResult<T>> {
    const startedAt = Date.now();
    try {
      const result = await this.driver.list(options);
      this.emit('list', options.prefix, startedAt, true);
      return result;
    } catch (error) {
      this.emit('list', options.prefix, startedAt, false, error);
      this.normalize(error, 'list', options.prefix);
    }
  }

  async *iterate(
    prefix?: string,
    options: Omit<ListOptions<T>, 'prefix' | 'recursive'> = {},
  ): AsyncIterable<StorageFile> {
    let cursor: string | undefined;
    do {
      const page: ListResult<T> = await this.list({
        ...options,
        prefix,
        recursive: true,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      for (const file of page.files) {
        yield file;
      }
      cursor = page.cursor;
    } while (cursor !== undefined);
  }

  async copy(
    source: string,
    destination: string,
    options: CopyOptions<T> = {},
  ): Promise<CopyResult<T>> {
    const startedAt = Date.now();
    try {
      const result = await this.driver.copy(source, destination, options);
      this.emit('copy', source, startedAt, true);
      return { ...result, provider: this.type } as CopyResult<T>;
    } catch (error) {
      this.emit('copy', source, startedAt, false, error);
      this.normalize(error, 'copy', source);
    }
  }

  async move(
    source: string,
    destination: string,
    options: MoveOptions<T> = {},
  ): Promise<import('./core/types.js').MoveResult<T>> {
    const startedAt = Date.now();
    try {
      const result = await this.driver.move(source, destination, options);
      this.emit('move', source, startedAt, true);
      return { ...result, provider: this.type };
    } catch (error) {
      this.emit('move', source, startedAt, false, error);
      this.normalize(error, 'move', source);
    }
  }

  async getUrl(path: string, options: UrlOptions<T> = {}): Promise<string> {
    try {
      return await this.driver.getUrl(path, options);
    } catch (error) {
      this.normalize(error, 'getUrl', path);
    }
  }

  async getSignedUrl(path: string, options: SignedUrlOptions<T> = {}): Promise<string> {
    const startedAt = Date.now();
    try {
      const result = await this.driver.getSignedUrl(path, options);
      this.emit('getSignedUrl', path, startedAt, true);
      return result;
    } catch (error) {
      this.emit('getSignedUrl', path, startedAt, false, error);
      this.normalize(error, 'getSignedUrl', path);
    }
  }

  native(): MapValueFor<NativeClientMap, T> {
    if (this.nativeCache === undefined) {
      this.nativeCache = this.driver.native();
    }
    return this.nativeCache as MapValueFor<NativeClientMap, T>;
  }

  nativeRequest<R>(fn: (client: MapValueFor<NativeClientMap, T>) => Promise<R>): Promise<R> {
    return this.driver.nativeRequest(fn);
  }

  capabilities(): StorageCapabilities {
    return this.driver.capabilities();
  }
}
