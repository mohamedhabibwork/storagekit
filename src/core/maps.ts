import type { StorageType } from './primitives';
import type {
  LocalNativeClient,
  LocalNativeDeleteOptions,
  LocalNativeDownloadOptions,
  LocalNativeDownloadResult,
  LocalNativeFileStat,
  LocalNativeListOptions,
  LocalNativeListResult,
  LocalNativeStatOptions,
  LocalNativeUploadOptions,
  LocalNativeUploadResult,
  LocalNativeUrlOptions,
  LocalStorageConfig,
} from '../drivers/local/local.types';
import type {
  S3NativeClient,
  S3NativeCopyOptions,
  S3NativeDeleteManyOptions,
  S3NativeDeleteOptions,
  S3NativeDownloadOptions,
  S3NativeDownloadResult,
  S3NativeFileStat,
  S3NativeListOptions,
  S3NativeListResult,
  S3NativeSignedUrlOptions,
  S3NativeUploadOptions,
  S3NativeUploadResult,
  S3NativeUrlOptions,
  S3StorageConfig,
} from '../drivers/s3/s3.types';
import type {
  MinioNativeClient,
  MinioNativeCopyOptions,
  MinioNativeDeleteOptions,
  MinioNativeDownloadOptions,
  MinioNativeDownloadResult,
  MinioNativeFileStat,
  MinioNativeListOptions,
  MinioNativeListResult,
  MinioNativeSignedUrlOptions,
  MinioNativeStatOptions,
  MinioNativeUploadOptions,
  MinioNativeUploadResult,
  MinioNativeUrlOptions,
  MinioStorageConfig,
} from '../drivers/minio/minio.types';
import type {
  AzureNativeClient,
  AzureNativeCopyOptions,
  AzureNativeDeleteManyOptions,
  AzureNativeDeleteOptions,
  AzureNativeDownloadOptions,
  AzureNativeDownloadResult,
  AzureNativeFileStat,
  AzureNativeListOptions,
  AzureNativeListResult,
  AzureNativeSignedUrlOptions,
  AzureNativeStatOptions,
  AzureNativeUploadOptions,
  AzureNativeUploadResult,
  AzureNativeUrlOptions,
  AzureStorageConfig,
} from '../drivers/azure/azure.types';
import type {
  OracleNativeClient,
  OracleNativeCopyOptions,
  OracleNativeDeleteOptions,
  OracleNativeDownloadOptions,
  OracleNativeDownloadResult,
  OracleNativeFileStat,
  OracleNativeListOptions,
  OracleNativeListResult,
  OracleNativeSignedUrlOptions,
  OracleNativeStatOptions,
  OracleNativeUploadOptions,
  OracleNativeUploadResult,
  OracleNativeUrlOptions,
  OracleStorageConfig,
} from '../drivers/oracle/oracle.types';
import type { RustfsStorageConfig } from '../drivers/rustfs/rustfs.types';
import type { S3NativeStatOptions } from '../drivers/s3/s3.types';

export type StorageConfig =
  | LocalStorageConfig
  | S3StorageConfig
  | MinioStorageConfig
  | AzureStorageConfig
  | OracleStorageConfig
  | RustfsStorageConfig;

export type StorageConfigMap = {
  local: LocalStorageConfig;
  s3: S3StorageConfig;
  minio: MinioStorageConfig;
  azure: AzureStorageConfig;
  oracle: OracleStorageConfig;
  rustfs: RustfsStorageConfig;
};

/** Per-provider option bags accepted under the `native` key. */
export interface NativeOptionsMap {
  local: LocalNativeUploadOptions;
  s3: S3NativeUploadOptions;
  minio: MinioNativeUploadOptions;
  azure: AzureNativeUploadOptions;
  oracle: OracleNativeUploadOptions;
  // RustFS is S3-compatible and ships no first-party JS SDK — it speaks the
  // AWS SDK v3 wire protocol exactly, so its native option bag is the same
  // shape as S3.
  rustfs: S3NativeUploadOptions;
}

export interface NativeDownloadOptionsMap {
  local: LocalNativeDownloadOptions;
  s3: S3NativeDownloadOptions;
  minio: MinioNativeDownloadOptions;
  azure: AzureNativeDownloadOptions;
  oracle: OracleNativeDownloadOptions;
  rustfs: S3NativeDownloadOptions;
}

export interface NativeStatOptionsMap {
  local: LocalNativeStatOptions;
  s3: S3NativeStatOptions;
  minio: MinioNativeStatOptions;
  azure: AzureNativeStatOptions;
  oracle: OracleNativeStatOptions;
  rustfs: S3NativeStatOptions;
}

export interface NativeDeleteOptionsMap {
  local: LocalNativeDeleteOptions;
  s3: S3NativeDeleteOptions;
  minio: MinioNativeDeleteOptions;
  azure: AzureNativeDeleteOptions;
  oracle: OracleNativeDeleteOptions;
  rustfs: S3NativeDeleteOptions;
}

export interface NativeDeleteManyOptionsMap {
  local: Record<string, never>;
  s3: S3NativeDeleteManyOptions;
  minio: Record<string, never>;
  azure: AzureNativeDeleteManyOptions;
  oracle: Record<string, never>;
  rustfs: S3NativeDeleteManyOptions;
}

export interface NativeListOptionsMap {
  local: LocalNativeListOptions;
  s3: S3NativeListOptions;
  minio: MinioNativeListOptions;
  azure: AzureNativeListOptions;
  oracle: OracleNativeListOptions;
  rustfs: S3NativeListOptions;
}

export interface NativeCopyOptionsMap {
  local: Record<string, never>;
  s3: S3NativeCopyOptions;
  minio: MinioNativeCopyOptions;
  azure: AzureNativeCopyOptions;
  oracle: OracleNativeCopyOptions;
  rustfs: S3NativeCopyOptions;
}

export interface NativeMoveOptionsMap {
  local: Record<string, never>;
  s3: S3NativeDeleteOptions;
  minio: MinioNativeDeleteOptions;
  azure: AzureNativeDeleteOptions;
  oracle: OracleNativeDeleteOptions;
  rustfs: S3NativeDeleteOptions;
}

export interface NativeSignedUrlOptionsMap {
  local: Record<string, never>;
  s3: S3NativeSignedUrlOptions;
  minio: MinioNativeSignedUrlOptions;
  azure: AzureNativeSignedUrlOptions;
  oracle: OracleNativeSignedUrlOptions;
  rustfs: S3NativeSignedUrlOptions;
}

export interface NativeUrlOptionsMap {
  local: LocalNativeUrlOptions;
  s3: S3NativeUrlOptions;
  minio: MinioNativeUrlOptions;
  azure: AzureNativeUrlOptions;
  oracle: OracleNativeUrlOptions;
  rustfs: S3NativeUrlOptions;
}

/** Per-provider result passthroughs returned under the `native` key. */
export interface NativeClientMap {
  local: LocalNativeClient;
  s3: S3NativeClient;
  minio: MinioNativeClient;
  azure: AzureNativeClient;
  oracle: OracleNativeClient;
  rustfs: S3NativeClient;
}

export interface NativeUploadResultMap {
  local: LocalNativeUploadResult;
  s3: S3NativeUploadResult;
  minio: MinioNativeUploadResult;
  azure: AzureNativeUploadResult;
  oracle: OracleNativeUploadResult;
  rustfs: S3NativeUploadResult;
}

export interface NativeDownloadResultMap {
  local: LocalNativeDownloadResult;
  s3: S3NativeDownloadResult;
  minio: MinioNativeDownloadResult;
  azure: AzureNativeDownloadResult;
  oracle: OracleNativeDownloadResult;
  rustfs: S3NativeDownloadResult;
}

export interface NativeFileStatMap {
  local: LocalNativeFileStat;
  s3: S3NativeFileStat;
  minio: MinioNativeFileStat;
  azure: AzureNativeFileStat;
  oracle: OracleNativeFileStat;
  rustfs: S3NativeFileStat;
}

export interface NativeListResultMap {
  local: LocalNativeListResult;
  s3: S3NativeListResult;
  minio: MinioNativeListResult;
  azure: AzureNativeListResult;
  oracle: OracleNativeListResult;
  rustfs: S3NativeListResult;
}

/**
 * Lookup into a provider map that tolerates CUSTOM (non-builtin) storage
 * types: builtin types get their strong native types, custom types fall
 * back to `unknown`.
 */
export type MapValueFor<M, T extends string> = T extends keyof M ? M[T] : unknown;

export type NativeOptionsFor<T extends string> = MapValueFor<NativeOptionsMap, T>;
export type NativeClientFor<T extends string> = MapValueFor<NativeClientMap, T>;
export type StorageConfigFor<T extends StorageType> = StorageConfigMap[T];
