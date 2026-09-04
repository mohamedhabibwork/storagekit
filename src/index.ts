/**
 * storagekit — unified file management across Local, AWS S3, MinIO,
 * Azure Blob and Oracle OCI Object Storage.
 *
 * The root entry does NOT import any cloud SDK. Import provider
 * entrypoints (`storagekit/s3`, `storagekit/azure`, ...) to create
 * storages, or use `createStorage()` from here which lazy-loads only the
 * configured driver.
 */
export {
  createStorage,
  type CreateStorageOptions,
  registerStorageDriver,
  unregisterStorageDriver,
  listStorageTypes,
  type StorageDriverFactory,
} from './factory';
export { defineDriver, type StorageDriver } from './drivers/driver';
export { createStorageManager } from './manager';
export type { StorageManager } from './manager';
export { copyBetween, type CopyBetweenOptions } from './copy-between';
export { StorageInstance } from './storage';

// Upload intake (framework-agnostic); framework-specific adapters live in
// `storagekit/adapters/*` subpath entries.
export {
  saveUpload,
  saveWebFile,
  sanitizeFilename,
  randomKey,
  type UploadFileInput,
  type SaveUploadOptions,
  type SavedUpload,
} from './uploads';

// Core types
export type {
  Storage,
  StorageConfig,
  StorageType,
  UploadBody,
  UploadOptions,
  UploadResult,
  DownloadOptions,
  DownloadResult,
  DeleteOptions,
  DeleteManyOptions,
  DeleteManyResult,
  ExistsOptions,
  StatOptions,
  FileStat,
  ListOptions,
  ListResult,
  StorageFile,
  CopyOptions,
  CopyResult,
  MoveOptions,
  MoveResult,
  SignedUrlOptions,
  SignedUrlAction,
  UrlOptions,
  MultipartOptions,
  RangeOptions,
  StorageCapabilities,
  StorageHooks,
  StorageOperationEvent,
} from './core/types';
export type {
  NativeOptionsMap,
  NativeClientMap,
  StorageConfigMap,
} from './core/maps';

// Errors
export {
  StorageError,
  StorageNotFoundError,
  StoragePermissionError,
  StorageConflictError,
  StorageInvalidConfigError,
  StorageNetworkError,
  StorageQuotaError,
  StorageUnsupportedOperationError,
  StorageInvalidPathError,
  isStorageError,
} from './core/errors';

// Path utilities (useful for building application-level keys)
export { normalizeKey, joinKey, encodeKeyPath } from './core/paths';
