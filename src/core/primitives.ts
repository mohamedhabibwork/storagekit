import { Readable } from 'node:stream';

/**
 * All storage backends supported by the package.
 */
export type StorageType = 'local' | 's3' | 'minio' | 'azure' | 'oracle' | 'rustfs';

/**
 * Accepted bodies for uploads. Streams are always preferred so large files
 * never need to be buffered in memory.
 */
export type UploadBody =
  | Buffer
  | Uint8Array
  | Readable
  | Blob
  | ArrayBuffer
  | string;

/**
 * Options that share the same meaning on every provider. Anything that is
 * provider-specific lives in the driver-typed `native` bag next to these.
 */
export interface BaseUploadOptions {
  contentType?: string;
  contentLength?: number;
  metadata?: Record<string, string>;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  /**
   * When false and the target already exists, the upload fails with a
   * {@link StorageConflictError}. Defaults to true.
   */
  overwrite?: boolean;
  /** Abort the upload. */
  signal?: AbortSignal;
}

/**
 * Tuning for multipart / chunked uploads. Drivers map these onto their
 * native multipart machinery and ignore what they cannot honor.
 */
export interface MultipartOptions {
  enabled?: boolean;
  /** Part size in bytes. */
  partSize?: number;
  /** Maximum number of concurrent part transfers. */
  concurrency?: number;
}

export type SignedUrlAction = 'read' | 'write' | 'delete';

export interface RangeOptions {
  /** Byte offset to start reading from. */
  offset: number;
  /** Number of bytes to read. Defaults to the rest of the object. */
  length?: number;
}

/**
 * Capabilities a driver advertises. Use this instead of relying on silent
 * emulation: unsupported capabilities surface as
 * {@link StorageUnsupportedOperationError}.
 */
export interface StorageCapabilities {
  signedUrls: boolean;
  multipartUpload: boolean;
  serverSideCopy: boolean;
  versioning: boolean;
  metadata: boolean;
  /** True only for the local driver where directories are real. */
  directories: boolean;
  /** Bulk deletion uses a provider-native batch endpoint. */
  bulkDelete: boolean;
}

export interface StorageFile {
  path: string;
  size?: number;
  etag?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
}

export interface OperationContext {
  operation: string;
  path?: string;
  startedAt: number;
}

export interface UploadHookContext extends OperationContext {
  operation: 'upload';
  path: string;
}

export interface DownloadHookContext extends OperationContext {
  operation: 'download';
  path: string;
}

export interface DeleteHookContext extends OperationContext {
  operation: 'delete';
  path: string;
}

export interface ErrorHookContext<TOp extends string = string>
  extends OperationContext {
  operation: TOp;
  path?: string;
  error: unknown;
}

export type StorageHooks = {
  beforeUpload?: (ctx: UploadHookContext) => void | Promise<void>;
  afterUpload?: (ctx: UploadHookContext) => void | Promise<void>;
  uploadError?: (ctx: ErrorHookContext<'upload'>) => void | Promise<void>;
  beforeDownload?: (ctx: DownloadHookContext) => void | Promise<void>;
  afterDownload?: (ctx: DownloadHookContext) => void | Promise<void>;
  downloadError?: (ctx: ErrorHookContext<'download'>) => void | Promise<void>;
  beforeDelete?: (ctx: DeleteHookContext) => void | Promise<void>;
  afterDelete?: (ctx: DeleteHookContext) => void | Promise<void>;
  deleteError?: (ctx: ErrorHookContext<'delete'>) => void | Promise<void>;
};

export interface StorageOperationEvent {
  /** Builtin type name or the custom driver's registered type. */
  provider: string;
  operation: string;
  path?: string;
  duration: number;
  success: boolean;
  error?: unknown;
}

export type OperationListener = (event: StorageOperationEvent) => void;
