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
import type { MapValueFor, NativeClientMap } from '../core/maps';

/**
 * Runtime contract implemented by every provider adapter — builtin or
 * custom. The type parameter is fixed to the driver's own storage type so
 * driver code stays fully typed while the wrapper layer works with the
 * erased form. Custom drivers get `unknown` native slots.
 */
export interface StorageDriver<
  T extends string = string,
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

  native(): MapValueFor<NativeClientMap, T>;

  nativeRequest<R>(fn: (client: MapValueFor<NativeClientMap, T>) => Promise<R>): Promise<R>;

  capabilities(): StorageCapabilities;
}


/**
 * Identity helper that types a custom driver implementation. Purely for
 * ergonomics — editor feedback and future-proofing.
 */
export function defineDriver<T extends string>(
  driver: StorageDriver<T>,
): StorageDriver<T> {
  return driver;
}
