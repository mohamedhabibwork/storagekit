import { createStorage } from '../../factory';
import type { Storage } from '../../core/types';
import type { GcsStorageConfig } from './gcs.types';

export { GcsDriver } from './gcs.driver';
export type { GcsStorageConfig } from './gcs.types';

/**
 * Create a Google Cloud Storage instance using the official
 * `@google-cloud/storage` client. Authenticates with Application Default
 * Credentials by default; pass `keyFilename` / `credentials` / `projectId`
 * to override. The factory loads the SDK lazily so consumers who do not
 * use this entrypoint do not pay for it.
 */
export function createGcsStorage(
  config: GcsStorageConfig,
  options?: Parameters<typeof createStorage>[1],
): Promise<Storage<'gcs'>> {
  return createStorage(config, options);
}
