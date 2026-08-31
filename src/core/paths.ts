import path from 'node:path';
import { StorageInvalidPathError } from './errors';

/**
 * Normalize a virtual object path:
 * - backslashes become forward slashes
 * - duplicate slashes collapse
 * - leading and trailing slashes are removed
 * - `.` segments are dropped
 * - `..` traversal is rejected instead of silently resolved
 *
 * Object keys always use `/` regardless of the host OS.
 */
export function normalizeKey(input: string): string {
  if (typeof input !== 'string') {
    throw new StorageInvalidPathError(`Path must be a string, got ${typeof input}`);
  }
  const replaced = input.replace(/\\/g, '/');
  const segments: string[] = [];
  for (const segment of replaced.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      throw new StorageInvalidPathError(
        `Path traversal is not allowed: "${input}"`,
      );
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    throw new StorageInvalidPathError(`Path must not be empty: "${input}"`);
  }
  if (segments.some((segment) => segment === '\0')) {
    throw new StorageInvalidPathError(`Path must not contain NUL bytes`);
  }
  return segments.join('/');
}

/** Join a configured prefix and a virtual path, if the prefix is set. */
export function joinKey(prefix: string | undefined, key: string): string {
  if (!prefix) return key;
  const left = prefix.replace(/\/+$/, '');
  return left ? `${left}/${key}` : key;
}

/**
 * Remove the configured prefix from a provider-side object name.
 * Names outside the prefix are returned unchanged (they can appear in
 * listings when the caller passes a cursor from a different scope).
 */
export function stripKey(prefix: string | undefined, name: string): string {
  if (!prefix) return name;
  const left = `${prefix.replace(/\/+$/, '')}/`;
  return name.startsWith(left) ? name.slice(left.length) : name;
}

/** Percent-encode every path segment but keep `/` separators. */
export function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Resolve a virtual key to an absolute path inside `root`, guaranteeing the
 * result can never escape the root (`StorageInvalidPathError` otherwise).
 */
export function resolveInsideRoot(root: string, key: string): string {
  const normalized = normalizeKey(key);
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, normalized);
  const rel = path.relative(absoluteRoot, absolute);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new StorageInvalidPathError(
      `Resolved path "${normalized}" escapes the configured root`,
    );
  }
  return absolute;
}
