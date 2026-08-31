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
  MapValueFor,
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
  MapValueFor,
  NativeClientMap,
  NativeOptionsMap,
  StorageConfig,
  StorageConfigMap,
} from './maps';

/**
 * Option/result generics accept ANY string so custom driver types flow
 * through: builtin types resolve their strong native maps, custom types
 * fall back to `unknown` (see {@link MapValueFor}).
 */

export interface UploadOptions<T extends string = StorageType>
  extends BaseUploadOptions {
  multipart?: MultipartOptions;
  /** Provider-native upload options, strongly typed by storage type. */
  native?: MapValueFor<NativeOptionsMap, T>;
}

export interface DownloadOptions<T extends string = StorageType> {
  versionId?: string;
  range?: RangeOptions;
  signal?: AbortSignal;
  native?: MapValueFor<NativeDownloadOptionsMap, T>;
}

export interface DeleteOptions<T extends string = StorageType> {
  versionId?: string;
  signal?: AbortSignal;
  native?: MapValueFor<NativeDeleteOptionsMap, T>;
}

export interface DeleteManyResult {
  deleted: string[];
  failed: Array<{ path: string; error: StorageErrorAlias }>;
}

type StorageErrorAlias = import('./errors').StorageError;

export interface DeleteManyOptions<T extends string = StorageType> {
  signal?: AbortSignal;
  native?: MapValueFor<NativeDeleteManyOptionsMap, T>;
}

export interface StatOptions<T extends string = StorageType> {
  versionId?: string;
  signal?: AbortSignal;
  native?: MapValueFor<NativeStatOptionsAlias, T>;
}

type NativeStatOptionsAlias = import('./maps').NativeStatOptionsMap;

export interface ExistsOptions<T extends string = StorageType> {
  signal?: AbortSignal;
  native?: MapValueFor<NativeStatOptionsAlias, T>;
}

export interface ListOptions<T extends string = StorageType> {
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
  native?: MapValueFor<NativeListOptionsMap, T>;
}

export interface ListResult<T extends string = StorageType> {
  files: StorageFile[];
  directories: string[];
  /** Opaque continuation token; undefined when exhausted. */
  cursor?: string;
  hasMore: boolean;
  native?: MapValueFor<NativeListResultMap, T>;
}

export interface CopyOptions<T extends string = StorageType> {
  overwrite?: boolean;
  contentType?: string;
  metadata?: Record<string, string>;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  signal?: AbortSignal;
  native?: MapValueFor<NativeCopyOptionsMap, T>;
}

export interface MoveOptions<T extends string = StorageType> {
  overwrite?: boolean;
  contentType?: string;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
  native?: MapValueFor<NativeMoveOptionsMap, T>;
}

export interface SignedUrlOptions<T extends string = StorageType> {
  action?: SignedUrlAction;
  /** Seconds until expiry. Defaults to 3600; capped at 7 days. */
  expiresIn?: number;
  signal?: AbortSignal;
  native?: MapValueFor<NativeSignedUrlOptionsMap, T>;
}

export interface UrlOptions<T extends string = StorageType> {
  native?: MapValueFor<NativeUrlOptionsMap, T>;
}

export interface UploadResult<T extends string = StorageType> {
  path: string;
  size?: number;
  etag?: string;
  versionId?: string;
  /** Public URL when derivable without network requests. */
  url?: string;
  provider: T;
  native?: MapValueFor<NativeUploadResultMap, T>;
}

export interface DownloadResult<T extends string = StorageType> {
  stream: Readable;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
  versionId?: string;
  range?: RangeOptions;
  provider: T;
  native?: MapValueFor<NativeDownloadResultMap, T>;
  buffer(): Promise<Buffer>;
  text(): Promise<string>;
  json<V = unknown>(): Promise<V>;
}

export interface FileStat<T extends string = StorageType> {
  path: string;
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
  versionId?: string;
  provider: T;
  native?: MapValueFor<NativeFileStatMap, T>;
}

export interface CopyResult<T extends string = StorageType> {
  source: string;
  destination: string;
  etag?: string;
  lastModified?: Date;
  provider: T;
  native?: unknown;
}

export interface MoveResult<T extends string = StorageType> {
  source: string;
  destination: string;
  etag?: string;
  provider: T;
}

/**
 * The unified, provider-typed storage interface. `T` is inferred from the
 * config `type` at creation time — builtin types get strongly-typed
 * `native` option bags and native clients; custom (registered) types get
 * `unknown` native slots.
 */
export interface Storage<T extends string = StorageType> {
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
  native(): MapValueFor<NativeClientMap, T>;

  /**
   * Escape hatch for SDK operations the package does not wrap.
   * The client passed to `fn` is the native, provider-typed one.
   */
  nativeRequest<R>(
    fn: (client: MapValueFor<NativeClientMap, T>) => Promise<R>,
  ): Promise<R>;

  capabilities(): StorageCapabilities;

  /** Subscribe to normalized operation events (durations, outcomes). */
  on(event: 'operation', listener: (event: StorageOperationEvent) => void): () => void;

  /** Configured hooks (read-only view). */
  hooks: StorageHooks;
}
