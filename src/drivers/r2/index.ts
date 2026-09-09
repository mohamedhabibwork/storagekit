import { createStorage } from '../../factory';
import type { Storage } from '../../core/types';
import type { R2StorageConfig } from './r2.types';

export { R2Driver } from './r2.driver';
export type { R2StorageConfig } from './r2.types';

/** Create Cloudflare R2 storage through its S3-compatible API. */
export function createR2Storage(
  config: R2StorageConfig,
  options?: Parameters<typeof createStorage>[1],
): Promise<Storage<'r2'>> {
  return createStorage(config, options);
}
