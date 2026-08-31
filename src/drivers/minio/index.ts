import { createStorage } from '../../factory';
import type { Storage } from '../../core/types';
import type { MinioStorageConfig } from './minio.types';

export { MinioDriver } from './minio.driver';
export type {
  MinioStorageConfig,
  MinioClientOptions,
  MinioNativeUploadOptions,
  MinioNativeDownloadOptions,
  MinioNativeStatOptions,
  MinioNativeDeleteOptions,
  MinioNativeListOptions,
  MinioNativeCopyOptions,
  MinioNativeSignedUrlOptions,
  MinioNativeUrlOptions,
  MinioNativeClient,
  MinioNativeFileStat,
  MinioNativeUploadResult,
  MinioNativeDownloadResult,
  MinioNativeListResult,
} from './minio.types';

/**
 * Create a MinIO storage using the official MinIO client. MinIO is a
 * first-class driver here — not an S3 alias — so MinIO-native options and
 * behavior remain available.
 */
export function createMinioStorage(
  config: MinioStorageConfig,
  options?: Parameters<typeof createStorage>[1],
): Promise<Storage<'minio'>> {
  return createStorage(config, options);
}
