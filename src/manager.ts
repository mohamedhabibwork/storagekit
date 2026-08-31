import type { StorageConfig } from './core/maps';
import type { Storage, StorageType } from './core/types';
import { createStorage, type CreateStorageOptions } from './factory';

export interface StorageManagerOptions extends CreateStorageOptions {}

/**
 * Multi-disk manager for applications using several storage systems.
 *
 * ```ts
 * const disks = createStorageManager({
 *   default: 'uploads',
 *   disks: {
 *     uploads: { type: 's3', bucket: 'uploads' },
 *     temp: { type: 'local', root: './storage/temp' },
 *   },
 * });
 *
 * await disks.disk('uploads').upload('a.txt', 'hello');
 * await disks.disk('temp').delete('a.txt');
 * ```
 */
export interface StorageManager<
  TDisks extends Record<string, StorageConfig>,
> {
  /** Get (and lazily create) a named disk. */
  disk<K extends keyof TDisks & string>(name: K): Promise<Storage<TDisks[K]['type']>>;
  /** The default disk. */
  defaultDisk(): Promise<Storage<StorageType>>;
  /** Names of the configured disks. */
  diskNames(): Array<keyof TDisks & string>;
  /** The default disk name. */
  defaultDiskName(): keyof TDisks & string;
}

export function createStorageManager<
  TDisks extends Record<string, StorageConfig>,
>(config: {
  default: keyof TDisks & string;
  disks: TDisks;
}): StorageManager<TDisks> {
  if (!config || !config.disks || typeof config.disks !== 'object') {
    throw new Error('createStorageManager requires a `disks` map');
  }
  if (!(config.default in config.disks)) {
    throw new Error(
      `Default disk "${String(config.default)}" is not present in the disks map`,
    );
  }

  const cache = new Map<string, Promise<Storage<StorageType>>>();

  const get = (name: keyof TDisks & string): Promise<Storage<StorageType>> => {
    const existing = cache.get(name);
    if (existing) return existing;
    const diskConfig = config.disks[name];
    if (!diskConfig) {
      return Promise.reject(
        new Error(`Unknown storage disk "${String(name)}". Configured disks: ${Object.keys(config.disks).join(', ')}`),
      );
    }
    const promise = createStorage(diskConfig).catch((error: unknown) => {
      cache.delete(name);
      throw error;
    });
    cache.set(name, promise);
    return promise;
  };

  return {
    disk: (name) => get(name) as never,
    defaultDisk: () => get(config.default),
    diskNames: () => Object.keys(config.disks) as Array<keyof TDisks & string>,
    defaultDiskName: () => config.default,
  };
}
