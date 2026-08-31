import type { Readable } from 'node:stream';
import type {
  CopyOptions,
  DeleteManyOptions,
  DeleteOptions,
  DownloadOptions,
  DownloadResult,
  ExistsOptions,
  FileStat,
  ListOptions,
  ListResult,
  MoveOptions,
  SignedUrlOptions,
  StatOptions,
  StorageCapabilities,
  StorageType,
  UploadBody,
  UploadOptions,
  UploadResult,
  UrlOptions,
} from '../core/types';
import type { NativeClientMap } from '../core/maps';

/**
 * Runtime contract implemented by every provider adapter. The type parameter
 * is fixed to the driver's own storage type so driver code stays fully typed
 * while the wrapper layer works with the erased form.
 */
export interface StorageDriver<
  T extends StorageType = StorageType,
> {
  readonly type: T;

  upload(
    path: string,
    body: UploadBody,
    options?: UploadOptions<T>,
  ): Promise<UploadResult<T>>;

  download(
    path: string,
    options?: DownloadOptions<T>,
  ): Promise<DownloadResult<T>>;

  delete(path: string, options?: DeleteOptions<T>): Promise<void>;

  deleteMany(
    paths: string[],
    options?: DeleteManyOptions<T>,
  ): Promise<{
    deleted: string[];
    failed: Array<{ path: string; error: unknown }>;
  }>;

  exists(path: string, options?: ExistsOptions<T>): Promise<boolean>;

  stat(path: string, options?: StatOptions<T>): Promise<FileStat<T>>;

  list(options?: ListOptions<T>): Promise<ListResult<T>>;

  copy(
    source: string,
    destination: string,
    options?: CopyOptions<T>,
  ): Promise<{ source: string; destination: string; etag?: string; lastModified?: Date }>;

  move(
    source: string,
    destination: string,
    options?: MoveOptions<T>,
  ): Promise<{ source: string; destination: string; etag?: string }>;

  getUrl(path: string, options?: UrlOptions<T>): Promise<string>;

  getSignedUrl(path: string, options?: SignedUrlOptions<T>): Promise<string>;

  native(): NativeClientMap[T];

  nativeRequest<R>(fn: (client: NativeClientMap[T]) => Promise<R>): Promise<R>;

  capabilities(): StorageCapabilities;
}

export function emptyDownloadResultHelpers(stream: Readable) {
  return {
    buffer: () => import('../core/streams.js').then((m) => m.streamToBuffer(stream)),
    text: () =>
      import('../core/streams.js').then(async (m) =>
        (await m.streamToBuffer(stream)).toString('utf8'),
      ),
    json: <V>() =>
      import('../core/streams.js').then(async (m) =>
        JSON.parse((await m.streamToBuffer(stream)).toString('utf8')) as V,
      ),
  };
}
