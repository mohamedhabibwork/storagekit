import { createStorage } from '../../factory';
import type { Storage } from '../../core/types';
import type { LocalStorageConfig } from './local.types';

export { LocalDriver } from './local.driver';
export type {
  LocalStorageConfig,
  LocalNativeUploadOptions,
  LocalNativeDownloadOptions,
  LocalNativeStatOptions,
  LocalNativeListOptions,
  LocalNativeDeleteOptions,
  LocalNativeClient,
  LocalNativeFileStat,
  LocalNativeUploadResult,
  LocalNativeDownloadResult,
  LocalNativeListResult,
  LocalNativeUrlOptions,
} from './local.types';

/**
 * Create a local-filesystem storage. Direct entrypoint — importing this
 * module never loads any cloud SDK.
 */
export function createLocalStorage(
  config: LocalStorageConfig,
  options?: Parameters<typeof createStorage>[1],
): Promise<Storage<'local'>> {
  return createStorage(config, options);
}
