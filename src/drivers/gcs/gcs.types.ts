import type {
  CopyOptions as GcsCopyOptions,
  CreateWriteStreamOptions as GcsCreateWriteStreamOptions,
  DeleteFileOptions as GcsDeleteFileOptions,
  GetSignedUrlConfig as GcsGetSignedUrlConfig,
  MoveOptions as GcsMoveOptions,
  StorageOptions as GcsStorageOptions,
  FileMetadata as GcsFileMetadata,
} from '@google-cloud/storage';

/**
 * Google Cloud Storage configuration. Backed by the official `@google-cloud/storage`
 * client, which talks the GCS REST API and authenticates with Application
 * Default Credentials, a service-account JSON file, or an explicit `credentials`
 * object.
 *
 * The root entry never imports the SDK — only the `storagekit/gcs` subpath
 * does. Loading this driver without the SDK installed raises a clear
 * `StorageInvalidConfigError` with the exact `npm install` command.
 */
export interface GcsStorageConfig {
  type: 'gcs';
  /** Bucket every operation is scoped to. */
  bucket: string;
  /** Project ID. Optional when running on GCP with ADC — the SDK resolves it. */
  projectId?: string;
  /** Path to a Google service-account JSON key file. */
  keyFilename?: string;
  /** Inline service-account credentials (parsed or already a `CredentialBody`). */
  credentials?: GcsStorageOptions['credentials'];
  /**
   * Override the API endpoint. Defaults to `storage.googleapis.com`. Useful
   * for [fake-gcs-server](https://github.com/fsouza/fake-gcs-server) and
   * emulators during local dev.
   */
  apiEndpoint?: string;
  /** Retry tuning forwarded to the SDK. */
  retryOptions?: GcsStorageOptions['retryOptions'];
  /** Virtual prefix every key is stored under, e.g. `production/`. */
  prefix?: string;
  /** Base URL used by `getUrl()` when a CDN fronts the bucket. */
  publicUrlBase?: string;
  /** Inject an existing `Storage` client instead of constructing one. */
  client?: import('@google-cloud/storage').Storage;
  /** Extra options forwarded to `new Storage(options)`. */
  clientOptions?: Partial<GcsStorageOptions>;
}

/** Anything a {@link GcsStorageConfig} does not already map, merged last. */
export type GcsNativeUploadOptions = Omit<GcsCreateWriteStreamOptions, 'contentType' | 'metadata'> & {
  /** Public-ACL shortcut — maps onto `predefinedAcl`. */
  predefinedAcl?: GcsCopyOptions['predefinedAcl'];
  /** Customer-managed KMS key — maps onto `kmsKeyName` for the underlying call. */
  kmsKeyName?: string;
  /** Custom metadata bag — maps onto the SDK `metadata` option. */
  metadata?: Record<string, string>;
};

export type GcsNativeDownloadOptions = Omit<
  import('@google-cloud/storage').CreateReadStreamOptions,
  'start' | 'end'
> & {
  /** Optional generation (alias for {@link DownloadOptions.versionId}). */
  generation?: string | number;
};

export type GcsNativeStatOptions = {
  generation?: string | number;
};

export type GcsNativeDeleteOptions = GcsDeleteFileOptions;
export type GcsNativeListOptions = import('@google-cloud/storage').GetFilesOptions;
export type GcsNativeCopyOptions = GcsCopyOptions;
export type GcsNativeMoveOptions = GcsMoveOptions;
export type GcsNativeSignedUrlOptions = Omit<GcsGetSignedUrlConfig, 'action' | 'version' | 'expires'> & {
  /**
   * Override the signing version. Defaults to `v4` (the only option that
   * works with bucket-bound IAM and the recommended choice).
   */
  version?: 'v2' | 'v4';
};
export type GcsNativeUrlOptions = Record<string, never>;

export type GcsNativeClient = import('@google-cloud/storage').Storage;
export type GcsNativeFileStat = GcsFileMetadata;
export type GcsNativeUploadResult = GcsFileMetadata;
export type GcsNativeDownloadResult = Omit<GcsFileMetadata, 'mediaLink'>;
export type GcsNativeListResult = GcsFileMetadata[];
