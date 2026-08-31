import { createStorage } from '../../factory';
import type { Storage } from '../../core/types';
import type { AzureStorageConfig } from './azure.types';

export { AzureDriver } from './azure.driver';
export type {
  AzureStorageConfig,
  AzureNativeUploadOptions,
  AzureNativeDownloadOptions,
  AzureNativeStatOptions,
  AzureNativeDeleteOptions,
  AzureNativeDeleteManyOptions,
  AzureNativeListOptions,
  AzureNativeCopyOptions,
  AzureNativeSignedUrlOptions,
  AzureNativeUrlOptions,
  AzureNativeClient,
  AzureNativeFileStat,
  AzureNativeUploadResult,
  AzureNativeDownloadResult,
  AzureNativeListResult,
} from './azure.types';

/**
 * Create an Azure Blob Storage. Direct entrypoint — importing this module
 * never loads the other providers' SDKs.
 */
export function createAzureStorage(
  config: AzureStorageConfig,
  options?: Parameters<typeof createStorage>[1],
): Promise<Storage<'azure'>> {
  return createStorage(config, options);
}
