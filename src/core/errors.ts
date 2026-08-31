import type { StorageType } from './primitives';

export interface StorageErrorOptions {
  /** Builtin type name or a custom driver's registered type. */
  provider?: StorageType | (string & {});
  operation?: string;
  path?: string;
  code?: string;
  cause?: unknown;
}

/**
 * Because each provider entrypoint bundles its own copy of this module,
 * `instanceof` across entrypoints would compare two distinct classes.
 * A global registry plus `Symbol.hasInstance` makes `error instanceof
 * StorageNotFoundError` work regardless of which copy raised it.
 */
const CLASS_REGISTRY: Record<string, new (...args: any[]) => StorageError> = (
  (globalThis as any)[Symbol.for('storagekit.error-registry')] ??= {}
);

function bindCrossBundleInstance<T extends new (...args: any[]) => StorageError>(
  ctor: T,
): void {
  const canonical = (CLASS_REGISTRY[ctor.name] ??= ctor) as T;
  Object.defineProperty(ctor, Symbol.hasInstance, {
    // isPrototypeOf bypasses Symbol.hasInstance, avoiding recursion.
    value: (instance: unknown): boolean =>
      (instance !== null &&
        typeof instance === 'object' &&
        canonical.prototype.isPrototypeOf(instance)) ||
      (instance instanceof Error && instance.name === ctor.name),
  });
}

/** True for any package error, no matter which entrypoint's copy raised it. */
export function isStorageError(error: unknown): error is StorageError {
  return (
    error instanceof Error &&
    typeof error.name === 'string' &&
    error.name.startsWith('Storage') &&
    KNOWN_ERROR_NAMES.has(error.name)
  );
}

const KNOWN_ERROR_NAMES = new Set([
  'StorageError',
  'StorageNotFoundError',
  'StoragePermissionError',
  'StorageConflictError',
  'StorageInvalidConfigError',
  'StorageNetworkError',
  'StorageQuotaError',
  'StorageUnsupportedOperationError',
  'StorageInvalidPathError',
]);

export class StorageError extends Error {
  readonly provider?: StorageType | (string & {});
  readonly operation?: string;
  readonly path?: string;
  /** Short machine-readable code, either package-level or provider-native. */
  readonly code?: string;

  constructor(message: string, options: StorageErrorOptions = {}) {
    super(message);
    this.name = 'StorageError';
    this.provider = options.provider;
    this.operation = options.operation;
    this.path = options.path;
    this.code = options.code;
    if (options.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
  }
}

export class StorageNotFoundError extends StorageError {
  constructor(message: string, options: StorageErrorOptions = {}) {
    super(message, options);
    this.name = 'StorageNotFoundError';
  }
}

export class StoragePermissionError extends StorageError {
  constructor(message: string, options: StorageErrorOptions = {}) {
    super(message, options);
    this.name = 'StoragePermissionError';
  }
}

export class StorageConflictError extends StorageError {
  constructor(message: string, options: StorageErrorOptions = {}) {
    super(message, options);
    this.name = 'StorageConflictError';
  }
}

export class StorageInvalidConfigError extends StorageError {
  constructor(message: string, options: StorageErrorOptions = {}) {
    super(message, options);
    this.name = 'StorageInvalidConfigError';
  }
}

export class StorageNetworkError extends StorageError {
  constructor(message: string, options: StorageErrorOptions = {}) {
    super(message, options);
    this.name = 'StorageNetworkError';
  }
}

export class StorageQuotaError extends StorageError {
  constructor(message: string, options: StorageErrorOptions = {}) {
    super(message, options);
    this.name = 'StorageQuotaError';
  }
}

export class StorageUnsupportedOperationError extends StorageError {
  constructor(message: string, options: StorageErrorOptions = {}) {
    super(message, options);
    this.name = 'StorageUnsupportedOperationError';
  }
}

export class StorageInvalidPathError extends StorageError {
  constructor(message: string, options: StorageErrorOptions = {}) {
    super(message, options);
    this.name = 'StorageInvalidPathError';
  }
}

for (const ctor of [
  StorageError,
  StorageNotFoundError,
  StoragePermissionError,
  StorageConflictError,
  StorageInvalidConfigError,
  StorageNetworkError,
  StorageQuotaError,
  StorageUnsupportedOperationError,
  StorageInvalidPathError,
]) {
  bindCrossBundleInstance(ctor);
}

/** Narrow an unknown thrown value to a provider error object if possible. */
function asErrorLike(error: unknown): Record<string, unknown> | undefined {
  if (error instanceof Error) {
    return error as unknown as Record<string, unknown>;
  }
  if (typeof error === 'object' && error !== null) {
    return error as Record<string, unknown>;
  }
  return undefined;
}

function readAnyCode(error: Record<string, unknown>): string | undefined {
  for (const key of ['code', 'Code', 'name', 'errorCode', 'errorName']) {
    const value = error[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function readStatus(error: Record<string, unknown>): number | undefined {
  const metadata = error.$metadata as { httpStatusCode?: number } | undefined;
  if (typeof metadata?.httpStatusCode === 'number') {
    return metadata.httpStatusCode;
  }
  for (const key of ['statusCode', 'http_statuscode', 'status', 'statuscode']) {
    const value = error[key];
    if (typeof value === 'number') return value;
  }
  return undefined;
}

const NOT_FOUND_CODES = new Set([
  'ENOENT',
  'NoSuchKey',
  'NoSuchObject',
  'NotFound',
  'BlobNotFound',
  'ContainerNotFound',
  'TheSpecifiedBlobDoesNotExist',
  'ENAMETOOLONG',
]);

const PERMISSION_CODES = new Set([
  'EACCES',
  'EPERM',
  'EISDIR',
  'AccessDenied',
  'AccessDeniedError',
  'AuthorizationFailure',
  'AuthorizationPermissionMismatch',
  'NotAuthenticated',
  'NotAuthorizedOrNotFound',
]);

const CONFLICT_CODES = new Set([
  'EEXIST',
  'BlobAlreadyExists',
  'PreconditionFailed',
  'ConditionalRequestNotMet',
  'CopyIdMismatch',
]);

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'NetworkingError',
  'RequestTimeout',
  'TimeoutError',
  'ConnectTimeout',
  'NoNetwork',
]);

const QUOTA_CODES = new Set([
  'QuotaExceeded',
  'InsufficientStorage',
  'StorageQuotaExceeded',
  'AccountIsDisabled',
  'TooManyRequests',
  'AccountLevelImmutabilityPolicyViolation',
]);

const ABORT_CODES = new Set(['AbortError', 'RequestAbortedError', 'CANCELLED']);

export interface NormalizeContext {
  /** Builtin type name or a custom driver's registered type. */
  provider: StorageType | (string & {});
  operation: string;
  path?: string;
  /** Map a provider-native code that the shared lists do not know about. */
  translateCode?: (code: string) => StorageError | undefined;
  /** Provide a friendlier message than `original.message`. */
  message?: (original: ErrorLike) => string;
}

export type ErrorLike = Error & {
  code?: string;
  name?: string;
  statusCode?: number;
  $metadata?: { httpStatusCode?: number };
};

/**
 * Convert any thrown value into a normalized {@link StorageError} subclass,
 * keeping the original error available on `cause`. Values that are already
 * package errors pass through untouched.
 */
export function normalizeError(
  thrown: unknown,
  ctx: NormalizeContext,
): StorageError {
  if (isStorageError(thrown)) return thrown;

  const like = asErrorLike(thrown);
  const code = like ? readAnyCode(like) : undefined;
  const status = like ? readStatus(like) : undefined;
  const causeMessage = thrown instanceof Error ? thrown.message : String(thrown);
  const message =
    (ctx.message && like
      ? ctx.message(like as unknown as ErrorLike)
      : undefined) ??
    `${ctx.provider} storage failed during ${ctx.operation}` +
      (ctx.path ? ` for "${ctx.path}"` : '') +
      `: ${causeMessage}`;

  const options: StorageErrorOptions = {
    provider: ctx.provider,
    operation: ctx.operation,
    path: ctx.path,
    code,
    cause: thrown,
  };

  if (ctx.translateCode && code) {
    const mapped = ctx.translateCode(code);
    if (mapped) return mapped;
  }

  if (code && ABORT_CODES.has(code)) {
    return new StorageError(`Operation aborted: ${message}`, {
      ...options,
      code: 'ABORTED',
    });
  }
  if (
    status === 404 ||
    (code && NOT_FOUND_CODES.has(code)) ||
    status === 410
  ) {
    return new StorageNotFoundError(message, options);
  }
  if (status === 401 || status === 403 || (code && PERMISSION_CODES.has(code))) {
    return new StoragePermissionError(message, options);
  }
  if (status === 409 || status === 412 || (code && CONFLICT_CODES.has(code))) {
    return new StorageConflictError(message, options);
  }
  if (status === 429 || status === 507 || (code && QUOTA_CODES.has(code))) {
    return new StorageQuotaError(message, options);
  }
  if (code && NETWORK_CODES.has(code)) {
    return new StorageNetworkError(message, options);
  }
  if (thrown instanceof Error && thrown.name === 'AbortError') {
    return new StorageError(`Operation aborted: ${message}`, {
      ...options,
      code: 'ABORTED',
    });
  }

  return new StorageError(message, options);
}

/** Re-throw unknown values as normalized package errors. */
export function throwNormalized(thrown: unknown, ctx: NormalizeContext): never {
  throw normalizeError(thrown, ctx);
}
