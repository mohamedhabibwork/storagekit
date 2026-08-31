import type { Stats } from 'node:fs';

/**
 * Local filesystem storage configuration.
 *
 * The local driver uses only Node.js built-ins (`node:fs`, `node:path`,
 * `node:stream`) — no extra dependencies.
 */
export interface LocalStorageConfig {
  type: 'local';
  /** Absolute or relative root directory for all stored files. */
  root: string;
  /**
   * Public base URL used by `getUrl()`, e.g. an express static route or CDN
   * that serves `root`. Without it `getUrl()` throws.
   */
  baseUrl?: string;
  /** Permissions applied to created files/directories (octal, e.g. 0o644). */
  permissions?: { file?: number; directory?: number };
  /** Create missing parent directories on upload. Defaults to true. */
  createDirectories?: boolean;
  /** Virtual prefix every key is stored under, e.g. `production/`. */
  prefix?: string;
  followSymlinks?: boolean;
}

/** Extra `fs` write options exposed on upload. */
export interface LocalNativeUploadOptions {
  mode?: number;
}

export interface LocalNativeDownloadOptions {
  encoding?: BufferEncoding;
}

export interface LocalNativeStatOptions {
  followSymlinks?: boolean;
}

export interface LocalNativeListOptions {
  followSymlinks?: boolean;
}

export interface LocalNativeDeleteOptions {
  /** Also recursively delete empty parent directories after the file. */
  cleanEmptyParents?: boolean;
}

export interface LocalNativeClient {
  /** The resolved absolute root directory. */
  root: string;
  /** Resolve a virtual key to an absolute path inside the root. */
  resolve(key: string): string;
}

export interface LocalNativeFileStat {
  stats: Stats;
}

export interface LocalNativeUploadResult {
  absolutePath: string;
}

export interface LocalNativeDownloadResult {
  absolutePath: string;
}

export interface LocalNativeListResult {
  root: string;
}

export interface LocalNativeUrlOptions {
  /** `true` turns the URL into a file:// URL. */
  fileUrl?: boolean;
}
