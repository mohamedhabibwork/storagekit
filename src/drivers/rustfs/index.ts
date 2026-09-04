import { createStorage } from '../../factory';
import type { Storage } from '../../core/types';
import type { RustfsStorageConfig } from './rustfs.types';

export { RustfsDriver } from './rustfs.driver';
export type { RustfsStorageConfig } from './rustfs.types';

/**
 * Create a RustFS storage using the AWS SDK v3 (RustFS is S3-compatible
 * and ships no first-party JS SDK — see `docs/rustfs.md`). The driver's
 * constructor applies RustFS' server defaults (`region: 'us-east-1'`,
 * `forcePathStyle: true`) when the caller did not override them.
 */
export function createRustfsStorage(
  config: RustfsStorageConfig,
  options?: Parameters<typeof createStorage>[1],
): Promise<Storage<'rustfs'>> {
  return createStorage(config, options);
}
