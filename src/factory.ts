import { StorageInvalidConfigError } from './core/errors';
import { normalizeKey } from './core/paths';
import type { StorageHooks, StorageType } from './core/types';
import type { Storage } from './core/types';
import type { StorageConfig } from './core/maps';
import { StorageInstance } from './storage';
import type { StorageDriver } from './drivers/driver';

export interface CreateStorageOptions {
  hooks?: StorageHooks;
  /** Subscribe to operation events at construction time. */
  onOperation?: import('./core/primitives').OperationListener;
  /**
   * Lightweight extension-based MIME detection for uploads that do not pass
   * an explicit `contentType`. Defaults to true.
   */
  detectContentType?: boolean;
}

const BUILTIN_TYPES = new Set<string>(['local', 's3', 'minio', 'azure', 'oracle', 'rustfs', 'gcs']);

/* ------------------------------------------------------------------ *
 * Custom driver registry
 * ------------------------------------------------------------------ */

/**
 * Factory that receives the raw config (everything except `type` is
 * driver-defined) plus the runtime options, and produces a driver —
 * synchronously or asynchronously. Drivers may expose an optional async
 * `ready()` which the factory awaits before first use.
 */
export type StorageDriverFactory = (
  config: { type: string } & Record<string, unknown>,
  runtime: { detectContentType?: boolean },
) => StorageDriver<string> | Promise<StorageDriver<string>>;

/**
 * Shared across module copies (each entrypoint bundles this file), so a
 * registration made through any entrypoint is visible everywhere.
 */
const DRIVER_REGISTRY: Map<string, StorageDriverFactory> = ((globalThis as Record<symbol, unknown>)[
  Symbol.for('storagekit.driver-registry')
] ??= new Map()) as Map<string, StorageDriverFactory>;

/**
 * Register a custom driver under a storage type. The type must not collide
 * with the builtin types (`local`, `s3`, `minio`, `azure`, `oracle`,
 * `rustfs`, `gcs`) or an
 * existing registration.
 *
 * ```ts
 * registerStorageDriver('memory', (config) => new MemoryDriver(config));
 * const storage = await createStorage({ type: 'memory', /* driver config *\/ });
 * ```
 */
export function registerStorageDriver(
  type: string,
  factory: StorageDriverFactory,
): void {
  if (typeof type !== 'string' || type.length === 0) {
    throw new StorageInvalidConfigError('registerStorageDriver requires a non-empty type string');
  }
  if (BUILTIN_TYPES.has(type)) {
    throw new StorageInvalidConfigError(
      `"${type}" is a builtin storage type and cannot be overridden`,
    );
  }
  if (DRIVER_REGISTRY.has(type)) {
    throw new StorageInvalidConfigError(
      `A custom driver is already registered for type "${type}"`,
    );
  }
  if (typeof factory !== 'function') {
    throw new StorageInvalidConfigError('registerStorageDriver requires a factory function');
  }
  DRIVER_REGISTRY.set(type, factory);
}

/** Types currently available through the factory, builtin and custom. */
export function listStorageTypes(): string[] {
  return [...BUILTIN_TYPES, ...DRIVER_REGISTRY.keys()];
}

/** Remove a custom driver registration (mainly for tests). */
export function unregisterStorageDriver(type: string): void {
  DRIVER_REGISTRY.delete(type);
}

/* ------------------------------------------------------------------ *
 * Config validation (builtin types)
 * ------------------------------------------------------------------ */

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
    case 'rustfs':
      if (typeof config.bucket !== 'string' || config.bucket.length === 0) {
        throw new StorageInvalidConfigError('rustfs storage requires a non-empty `bucket`');
      }
      if (typeof config.endpoint !== 'string' || config.endpoint.length === 0) {
        throw new StorageInvalidConfigError('rustfs storage requires a non-empty `endpoint`');
      }
      if (config.prefix !== undefined) normalizeKey(config.prefix);
      break;
    case 'gcs':
      if (typeof config.bucket !== 'string' || config.bucket.length === 0) {
        throw new StorageInvalidConfigError('gcs storage requires a non-empty `bucket`');
      }
      if (config.prefix !== undefined) normalizeKey(config.prefix);
      break;
  }
}

type AnyDriver = StorageDriver<string>;

/** Resolve a custom driver from the registry and await its `ready()` hook. */
async function createCustomDriver(
  type: string,
  config: Record<string, unknown>,
  runtime: { detectContentType?: boolean },
): Promise<AnyDriver> {
  const factory = DRIVER_REGISTRY.get(type);
  if (!factory) {
    throw new StorageInvalidConfigError(
      `Unknown storage type "${type}". Builtin types: ${[...BUILTIN_TYPES].join(', ')}. ` +
        'Custom drivers must be registered first: registerStorageDriver(type, factory).',
    );
  }
  const driver = await factory(config as { type: string }, runtime);
  if (
    !driver ||
    typeof driver.upload !== 'function' ||
    typeof driver.download !== 'function' ||
    typeof driver.type !== 'string'
  ) {
    throw new StorageInvalidConfigError(
      `The custom driver registered for "${type}" does not implement the StorageDriver interface`,
    );
  }
  await (driver as { ready?: () => Promise<unknown> }).ready?.();
  return driver;
}

/**
 * Create a provider-typed storage instance. The returned type is inferred
 * from the config — `createStorage({ type: 's3', ... })` yields
 * `Storage<'s3'>`, so every `native` option bag accepts exactly the
 * provider's real options.
 *
 * Builtin driver modules (and their SDKs) are loaded lazily: only the
 * configured provider's SDK is imported, and a missing SDK raises a clear
 * installation error instead of a module-not-found crash.
 *
 * Custom drivers registered with {@link registerStorageDriver} are resolved
 * by their `type` string; their configs keep arbitrary extra fields and the
 * native slots are typed `unknown`.
 */
export async function createStorage<T extends StorageType>(
  config: T extends StorageType
    ? Extract<StorageConfig, { type: T }>
    : never,
  options?: CreateStorageOptions,
): Promise<Storage<T>>;
export async function createStorage<T extends string>(
  config: { type: T } & (T extends StorageType ? never : Record<string, unknown>),
  options?: CreateStorageOptions,
): Promise<Storage<T>>;
export async function createStorage(
  config: { type: string },
  options: CreateStorageOptions = {},
): Promise<Storage<any>> {
  const type = config?.type;
  const runtime = { detectContentType: options.detectContentType };

  let driver: AnyDriver;
  if (BUILTIN_TYPES.has(type)) {
    assertValidConfig(config as unknown as StorageConfig);
    switch (type) {
      case 'local': {
        const { LocalDriver } = await import('./drivers/local/local.driver');
        driver = new LocalDriver(config as never, runtime) as never;
        break;
      }
      case 's3': {
        const { S3Driver } = await import('./drivers/s3/s3.driver');
        driver = new S3Driver(config as never, runtime) as never;
        await (driver as unknown as { ready(): Promise<unknown> }).ready();
        break;
      }
      case 'minio': {
        const { MinioDriver } = await import('./drivers/minio/minio.driver');
        driver = new MinioDriver(config as never, runtime) as never;
        await (driver as unknown as { ready(): Promise<unknown> }).ready();
        break;
      }
      case 'azure': {
        const { AzureDriver } = await import('./drivers/azure/azure.driver');
        driver = new AzureDriver(config as never, runtime) as never;
        await (driver as unknown as { ready(): Promise<unknown> }).ready();
        break;
      }
      case 'oracle': {
        const { OracleDriver } = await import('./drivers/oracle/oracle.driver');
        driver = new OracleDriver(config as never, runtime) as never;
        await (driver as unknown as { ready(): Promise<unknown> }).ready();
        break;
      }
      case 'rustfs': {
        const { RustfsDriver } = await import('./drivers/rustfs/rustfs.driver');
        driver = new RustfsDriver(config as never, runtime) as never;
        await (driver as unknown as { ready(): Promise<unknown> }).ready();
        break;
      }
      case 'gcs': {
        const { GcsDriver } = await import('./drivers/gcs/gcs.driver');
        driver = new GcsDriver(config as never, runtime) as never;
        await (driver as unknown as { ready(): Promise<unknown> }).ready();
        break;
      }
      default:
        throw new StorageInvalidConfigError(`Unknown storage type: ${String(type)}`);
    }
  } else {
    driver = await createCustomDriver(type, config as Record<string, unknown>, runtime);
  }

  return new StorageInstance<string>(driver as never, {
    hooks: options.hooks,
    onOperation: options.onOperation,
  });
}
