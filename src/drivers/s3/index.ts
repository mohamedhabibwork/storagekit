import { createStorage } from '../../factory';
import type { Storage } from '../../core/types';
import type { S3StorageConfig } from './s3.types';

export { S3Driver } from './s3.driver';
export type {
  S3StorageConfig,
  S3NativeUploadOptions,
  S3NativeDownloadOptions,
  S3NativeStatOptions,
  S3NativeDeleteOptions,
  S3NativeDeleteManyOptions,
  S3NativeListOptions,
  S3NativeCopyOptions,
  S3NativeSignedUrlOptions,
  S3NativeUrlOptions,
  S3NativeClient,
  S3NativeFileStat,
  S3NativeUploadResult,
  S3NativeDownloadResult,
  S3NativeListResult,
} from './s3.types';

/**
 * Create an AWS S3 storage. Direct entrypoint — importing this module never
 * loads the other providers' SDKs (the AWS SDK itself is required here).
 */
export function createS3Storage(
  config: S3StorageConfig,
  options?: Parameters<typeof createStorage>[1],
): Promise<Storage<'s3'>> {
  return createStorage(config, options);
}
