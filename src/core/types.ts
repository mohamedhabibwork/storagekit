import type { Readable } from 'node:stream';
import type {
  BaseUploadOptions,
  MultipartOptions,
  RangeOptions,
  SignedUrlAction,
  StorageCapabilities,
  StorageFile,
  StorageHooks,
  StorageOperationEvent,
  StorageType,
  UploadBody,
} from './primitives';
import type {
  NativeClientMap,
  NativeCopyOptionsMap,
  NativeDeleteManyOptionsMap,
  NativeDeleteOptionsMap,
  NativeDownloadOptionsMap,
  NativeDownloadResultMap,
  NativeFileStatMap,
  NativeListOptionsMap,
  NativeListResultMap,
  NativeMoveOptionsMap,
  NativeOptionsMap,
  NativeSignedUrlOptionsMap,
  NativeUploadResultMap,
  NativeUrlOptionsMap,
} from './maps';

export type {
  BaseUploadOptions,
  MultipartOptions,
  OperationListener,
  RangeOptions,
  SignedUrlAction,
  StorageCapabilities,
  StorageFile,
  StorageHooks,
  StorageOperationEvent,
  StorageType,
  UploadBody,
} from './primitives';
export type {
  NativeClientMap,
  NativeOptionsMap,
  StorageConfig,
  StorageConfigMap,
} from './maps';

export interface UploadOptions<T extends StorageType = StorageType>
  extends BaseUploadOptions {
  multipart?: MultipartOptions;
  /** Provider-native upload options, strongly typed by storage type. */
  native?: NativeOptionsMap[T];
}

export interface DownloadOptions<T extends StorageType = StorageType> {
  versionId?: string;
  range?: RangeOptions;
  signal?: AbortSignal;
  native?: NativeDownloadOptionsMap[T];
}

export interface DeleteOptions<T extends StorageType = StorageType> {
  versionId?: string;
  signal?: AbortSignal;
  native?: NativeDeleteOptionsMap[T];
}

export interface DeleteManyResult {
  deleted: string[];
  failed: Array<{ path: string; error: StorageErrorAlias }>;
}

type StorageErrorAlias = import('./errors.js').StorageError;

export interface DeleteManyOptions<T extends StorageType = StorageType> {
  signal?: AbortSignal;
  native?: NativeDeleteManyOptionsMap[T];
}

export interface StatOptions<T extends StorageType = StorageType> {
  versionId?: string;
  signal?: AbortSignal;
  native?: NativeStatOptionsAlias[T];
}

type NativeStatOptionsAlias = import('./maps.js').NativeStatOptionsMap;

export interface ExistsOptions<T extends StorageType = StorageType> {
  signal?: AbortSignal;
  native?: NativeStatOptionsAlias[T];
}

export interface ListOptions<T extends StorageType = StorageType> {
  prefix?: string;
  /** Maximum number of entries (files + directories) returned per page. */
  limit?: number;
  /** Opaque cursor from a previous {@link ListResult}. */
  cursor?: string;
  /**
   * When false (default) listings are one level deep and `directories` is
   * populated; when true the listing is flat and recursive like a plain
   * object scan, which is what `iterate()` uses.
   */
  recursive?: boolean;
  signal?: AbortSignal;
  native?: NativeListOptionsMap[T];
}

export interface ListResult<T extends StorageType = StorageType> {
  files: StorageFile[];
  directories: string[];
  /** Opaque continuation token; undefined when exhausted. */
  cursor?: string;
  hasMore: boolean;
  native?: NativeListResultMap[T];
}

export interface CopyOptions<T extends StorageType = StorageType> {
  overwrite?: boolean;
  contentType?: string;
  metadata?: Record<string, string>;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  signal?: AbortSignal;
  native?: NativeCopyOptionsMap[T];
}

export interface MoveOptions<T extends StorageType = StorageType> {
  overwrite?: boolean;
  contentType?: string;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
  native?: NativeMoveOptionsMap[T];
}

export interface SignedUrlOptions<T extends StorageType = StorageType> {
  action?: SignedUrlAction;
  /** Seconds until expiry. Defaults to 3600; capped at 7 days. */
  expiresIn?: number;
  signal?: AbortSignal;
  native?: NativeSignedUrlOptionsMap[T];
}

export interface UrlOptions<T extends StorageType = StorageType> {
  native?: NativeUrlOptionsMap[T];
}

export interface UploadResult<T extends StorageType = StorageType> {
  path: string;
  size?: number;
  etag?: string;
  versionId?: string;
  /** Public URL when derivable without network requests. */
  url?: string;
  provider: T;
  native?: NativeUploadResultMap[T];
}

export interface DownloadResult<T extends StorageType = StorageType> {
  stream: Readable;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
  versionId?: string;
  range?: RangeOptions;
  provider: T;
  native?: NativeDownloadResultMap[T];
  buffer(): Promise<Buffer>;
  text(): Promise<string>;
  json<V = unknown>(): Promise<V>;
}

export interface FileStat<T extends StorageType = StorageType> {
  path: string;
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
  versionId?: string;
  provider: T;
  native?: NativeFileStatMap[T];
}

export interface CopyResult<T extends StorageType = StorageType> {
  source: string;
  destination: string;
  etag?: string;
  lastModified?: Date;
  provider: T;
  native?: unknown;
}

export interface MoveResult<T extends StorageType = StorageType> {
  source: string;
  destination: string;
  etag?: string;
  provider: T;
}

/**
 * The unified, provider-typed storage interface. `T` drives both the config
 * validation at creation time and which `native` options every method
 * accepts — a `Storage<'s3'>` accepts real AWS options, a `Storage<'azure'>`
 * accepts Azure ones, while all common operations share one API.
 */
export interface Storage<T extends StorageType = StorageType> {
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
  ): Promise<DeleteManyResult>;

  exists(path: string, options?: ExistsOptions<T>): Promise<boolean>;

  stat(path: string, options?: StatOptions<T>): Promise<FileStat<T>>;

  list(options?: ListOptions<T>): Promise<ListResult<T>>;

  /**
   * Recursively walk everything under `prefix`, transparently following
   * pagination. Yields files only.
   */
  iterate(prefix?: string, options?: Omit<ListOptions<T>, 'prefix' | 'recursive'>): AsyncIterable<StorageFile>;

  copy(
    source: string,
    destination: string,
    options?: CopyOptions<T>,
  ): Promise<CopyResult<T>>;

  move(
    source: string,
    destination: string,
    options?: MoveOptions<T>,
  ): Promise<MoveResult<T>>;

  /** Public, unsigned URL. Never performs network requests. */
  getUrl(path: string, options?: UrlOptions<T>): Promise<string>;

  /** Provider-signed URL for read/write/delete access. */
  getSignedUrl(
    path: string,
    options?: SignedUrlOptions<T>,
  ): Promise<string>;

  /** The underlying native SDK client, typed per provider. */
  native(): NativeClientMap[T];

  /**
   * Escape hatch for SDK operations the package does not wrap.
   * The client passed to `fn` is the native, provider-typed one.
   */
  nativeRequest<R>(
    fn: (client: NativeClientMap[T]) => Promise<R>,
  ): Promise<R>;

  capabilities(): StorageCapabilities;

  /** Subscribe to normalized operation events (durations, outcomes). */
  on(event: 'operation', listener: (event: StorageOperationEvent) => void): () => void;

  /** Configured hooks (read-only view). */
  hooks: StorageHooks;
}
