import { StorageInvalidConfigError } from './core/errors';
import { normalizeKey } from './core/paths';
import type { StorageHooks, StorageType } from './core/types';
import type { Storage } from './core/types';
import type { StorageConfig } from './core/maps';
import { StorageInstance } from './storage';

export interface CreateStorageOptions {
  hooks?: StorageHooks;
  /** Subscribe to operation events at construction time. */
  onOperation?: import('./core/primitives.js').OperationListener;
  /**
   * Lightweight extension-based MIME detection for uploads that do not pass
   * an explicit `contentType`. Defaults to true.
   */
  detectContentType?: boolean;
}

/**
 * Validate the config shape per storage type. TypeScript already enforces
 * this statically; these checks catch values coming from untyped sources
 * (env vars, JSON files, API payloads).
 */
function assertValidConfig(config: StorageConfig): void {
  switch (config.type) {
    case 'local':
      if (typeof config.root !== 'string' || config.root.length === 0) {
        throw new StorageInvalidConfigError('local storage requires a non-empty `root`');
      }
      break;
    case 's3':
      if (typeof config.bucket !== 'string' || config.bucket.length === 0) {
        throw new StorageInvalidConfigError('s3 storage requires a non-empty `bucket`');
      }
      if (config.prefix !== undefined) normalizeKey(config.prefix);
      break;
    case 'minio':
      if (typeof config.bucket !== 'string' || config.bucket.length === 0) {
        throw new StorageInvalidConfigError('minio storage requires a non-empty `bucket`');
      }
      if (typeof config.endPoint !== 'string' || config.endPoint.length === 0) {
        throw new StorageInvalidConfigError('minio storage requires a non-empty `endPoint`');
      }
      if (config.prefix !== undefined) normalizeKey(config.prefix);
      break;
    case 'azure': {
      if (typeof config.container !== 'string' || config.container.length === 0) {
        throw new StorageInvalidConfigError('azure storage requires a non-empty `container`');
      }
      if (
        !config.connectionString &&
        !config.accountUrl &&
        !config.serviceClient &&
        !config.containerClient
      ) {
        throw new StorageInvalidConfigError(
          'azure storage requires one of: connectionString, accountUrl (+ credential), serviceClient, or containerClient',
        );
      }
      if (config.prefix !== undefined) normalizeKey(config.prefix);
      break;
    }
    case 'oracle':
      if (typeof config.namespaceName !== 'string' || config.namespaceName.length === 0) {
        throw new StorageInvalidConfigError('oracle storage requires a non-empty `namespaceName`');
      }
      if (typeof config.bucketName !== 'string' || config.bucketName.length === 0) {
        throw new StorageInvalidConfigError('oracle storage requires a non-empty `bucketName`');
      }
      if (config.prefix !== undefined) normalizeKey(config.prefix);
      break;
    default: {
      const unknown = config as { type?: string };
      throw new StorageInvalidConfigError(
        `Unknown storage type: ${String(unknown.type)}`,
      );
    }
  }
}

/**
 * Create a provider-typed storage instance. The returned type is inferred
 * from the config — `createStorage({ type: 's3', ... })` yields
 * `Storage<'s3'>`, so every `native` option bag accepts exactly the
 * provider's real options.
 *
 * Driver modules (and their SDKs) are loaded lazily: only the configured
 * provider's SDK is imported, and a missing SDK raises a clear
 * installation error instead of a module-not-found crash.
 */
export async function createStorage<T extends StorageType>(
  config: T extends StorageType
    ? Extract<StorageConfig, { type: T }>
    : never,
  options: CreateStorageOptions = {},
): Promise<Storage<T>> {
  assertValidConfig(config);
  const runtime = {
    detectContentType: options.detectContentType,
  };

  let driver: import('./drivers/driver.js').StorageDriver<T>;
  switch (config.type) {
    case 'local': {
      const { LocalDriver } = await import('./drivers/local/local.driver.js');
      driver = new LocalDriver(config, runtime) as never;
      break;
    }
    case 's3': {
      const { S3Driver } = await import('./drivers/s3/s3.driver.js');
      driver = new S3Driver(config, runtime) as never;
      await (driver as unknown as { ready(): Promise<unknown> }).ready();
      break;
    }
    case 'minio': {
      const { MinioDriver } = await import('./drivers/minio/minio.driver.js');
      driver = new MinioDriver(config, runtime) as never;
      await (driver as unknown as { ready(): Promise<unknown> }).ready();
      break;
    }
    case 'azure': {
      const { AzureDriver } = await import('./drivers/azure/azure.driver.js');
      driver = new AzureDriver(config, runtime) as never;
      await (driver as unknown as { ready(): Promise<unknown> }).ready();
      break;
    }
    case 'oracle': {
      const { OracleDriver } = await import('./drivers/oracle/oracle.driver.js');
      driver = new OracleDriver(config, runtime) as never;
      await (driver as unknown as { ready(): Promise<unknown> }).ready();
      break;
    }
  }

  return new StorageInstance<T>(driver, {
    hooks: options.hooks,
    onOperation: options.onOperation,
  });
}
