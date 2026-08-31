import type { Client, ClientOptions } from 'minio';

/**
 * MinIO storage configuration using the official `minio` JavaScript client.
 * Deliberately a first-class driver — not an alias of the S3 driver — so
 * MinIO-native options and behavior stay available.
 */
export interface MinioStorageConfig {
  type: 'minio';
  bucket: string;
  endPoint: string;
  port?: number;
  useSSL?: boolean;
  accessKey?: string;
  secretKey?: string;
  region?: string;
  /** Virtual prefix every key is stored under, e.g. `production/`. */
  prefix?: string;
  /** Base URL used by `getUrl()` when a CDN fronts the server. */
  publicUrlBase?: string;
  /** Extra options forwarded to `new Client(options)`. */
  clientOptions?: Partial<ClientOptions>;
  /** Inject an existing MinIO Client instead of constructing one. */
  client?: Client;
}

/** Alias of the native `minio.ClientOptions`. */
export type MinioClientOptions = ClientOptions;

/** Extra item metadata merged into the upload's `x-amz-meta*` bag. */
export interface MinioNativeUploadOptions {
  metaData?: Record<string, string | number | boolean>;
}

export interface MinioNativeDownloadOptions {
  versionId?: string;
  sseCustomerAlgorithm?: string;
  sseCustomerKey?: string;
  sseCustomerKeyMD5?: string;
}

export interface MinioNativeStatOptions {
  versionId?: string;
}

export interface MinioNativeDeleteOptions {
  versionId?: string;
}

/**
 * Reserved for provider-specific listing options; MinIO's native
 * `listObjectsV2Query` parameters `delimiter`/`maxKeys`/`start-after` are
 * controlled by the driver to keep listing behavior identical to the other
 * providers.
 */
export interface MinioNativeListOptions {
  recursive?: boolean;
}

/** Native copy preconditions (maps onto `CopyConditions`). */
export interface MinioNativeCopyOptions {
  matchETag?: string;
  matchETagExcept?: string;
  modifiedSince?: Date;
  unmodifiedSince?: Date;
}

export interface MinioNativeSignedUrlOptions {
  /**
   * Query params appended to the presigned URL, e.g.
   * `{ 'response-content-disposition': 'attachment; filename="a.pdf"' }`.
   */
  responseHeaders?: Record<string, string>;
  requestDate?: Date;
}

export interface MinioNativeUrlOptions {}

export type MinioNativeClient = Client;

export interface MinioNativeFileStat {
  size: number;
  etag: string;
  lastModified: Date;
  metaData: Record<string, unknown>;
  versionId?: string | null;
}

export interface MinioNativeUploadResult {
  etag: string;
  versionId: string | null;
}

export interface MinioNativeDownloadResult {}

export interface MinioNativeListResult {}
