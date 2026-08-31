import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

import {
  StorageConflictError,
  StorageError,
  StorageUnsupportedOperationError,
  normalizeError,
} from '../../core/errors';
import {
  DEFAULT_CONTENT_TYPE,
  detectContentTypeFromPath,
} from '../../core/mime';
import {
  encodeKeyPath,
  joinKey,
  normalizeKey,
  resolveInsideRoot,
  stripKey,
} from '../../core/paths';
import {
  bodyLength,
  bodyToReadable,
  streamToBuffer,
} from '../../core/streams';
import type { UploadBody } from '../../core/primitives';
import type {
  CopyOptions,
  DeleteManyOptions,
  DeleteManyResult,
  DeleteOptions,
  DownloadOptions,
  DownloadResult,
  ExistsOptions,
  FileStat,
  ListOptions,
  ListResult,
  MoveOptions,
  SignedUrlOptions,
  StatOptions,
  StorageCapabilities,
  StorageFile,
  UploadOptions,
  UploadResult,
  UrlOptions,
} from '../../core/types';
import type {
  LocalNativeClient,
  LocalStorageConfig,
} from './local.types';
import type { StorageDriver } from '../driver';

export interface LocalDriverRuntimeOptions {
  detectContentType?: boolean;
}

interface Entry {
  /** Internal key (prefix included); directories carry a trailing `/`. */
  key: string;
  /** Bare segment name, no slashes. */
  name: string;
  isDirectory: boolean;
  size?: number;
  lastModified?: Date;
}

/** Sort key that makes DFS order equal to plain lexicographic order. */
function sortKeyOf(key: string): string {
  return `${key
    .split('/')
    .map((segment) => `${segment}/`)
    .join('')}`;
}

function isMissingError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENAMETOOLONG';
}

export class LocalDriver implements StorageDriver<'local'> {
  readonly type = 'local' as const;

  readonly root: string;
  private readonly config: LocalStorageConfig;
  private readonly runtime: LocalDriverRuntimeOptions;
  private readonly prefix?: string;
  private nativeClient: LocalNativeClient | undefined;

  constructor(config: LocalStorageConfig, runtime: LocalDriverRuntimeOptions = {}) {
    this.config = config;
    this.runtime = runtime;
    this.root = path.resolve(config.root);
    this.prefix = config.prefix?.replace(/\/+$/, '') || undefined;
    if (this.prefix) normalizeKey(this.prefix);
  }

  native(): LocalNativeClient {
    if (!this.nativeClient) {
      this.nativeClient = {
        root: this.root,
        resolve: (key: string) =>
          resolveInsideRoot(this.root, joinKey(this.prefix, key)),
      };
    }
    return this.nativeClient;
  }

  nativeRequest<R>(fn: (client: LocalNativeClient) => Promise<R>): Promise<R> {
    return fn(this.native());
  }

  capabilities(): StorageCapabilities {
    return {
      signedUrls: false,
      multipartUpload: false,
      serverSideCopy: true,
      versioning: false,
      metadata: false,
      directories: true,
      bulkDelete: false,
    };
  }

  private resolveKey(key: string): string {
    return resolveInsideRoot(this.root, joinKey(this.prefix, key));
  }

  private fail(error: unknown, operation: string, key?: string): never {
    throw normalizeError(error, { provider: 'local', operation, path: key });
  }

  private async assertOverwriteAllowed(key: string, overwrite: boolean): Promise<void> {
    if (overwrite) return;
    const exists = await fs
      .access(this.resolveKey(key))
      .then(() => true)
      .catch((error: unknown) => {
        if (isMissingError(error)) return false;
        throw error;
      });
    if (exists) {
      throw new StorageConflictError(
        `"${key}" already exists and overwrite is disabled`,
        { provider: 'local', path: key },
      );
    }
  }

  private mkdirOptions(recursive = true) {
    return {
      recursive,
      mode: this.config.permissions?.directory,
    };
  }

  async upload(
    key: string,
    body: UploadBody,
    options: UploadOptions<'local'> = {},
  ): Promise<UploadResult<'local'>> {
    const normalized = normalizeKey(key);
    try {
      await this.assertOverwriteAllowed(normalized, options.overwrite ?? true);

      const absolute = this.resolveKey(normalized);
      if (this.config.createDirectories !== false) {
        await fs.mkdir(path.dirname(absolute), this.mkdirOptions());
      }

      const contentType =
        options.contentType ??
        (this.runtime.detectContentType !== false
          ? detectContentTypeFromPath(normalized)
          : undefined);

      const stream = bodyToReadable(body);
      try {
        await pipeline(
          stream,
          createWriteStream(absolute, {
            mode: options.native?.mode ?? this.config.permissions?.file,
          }),
        );
      } catch (error) {
        await fs.unlink(absolute).catch(() => undefined);
        throw error;
      }

      const size = bodyLength(body) ?? (await fs.stat(absolute)).size;

      let url: string | undefined;
      if (this.config.baseUrl) {
        const base = this.config.baseUrl.replace(/\/+$/, '');
        url = `${base}/${encodeKeyPath(joinKey(this.prefix, normalized))}`;
      }

      return {
        path: normalized,
        size,
        url,
        provider: 'local',
        native: { absolutePath: absolute },
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'upload', normalized);
    }
  }

  async download(
    key: string,
    options: DownloadOptions<'local'> = {},
  ): Promise<DownloadResult<'local'>> {
    const normalized = normalizeKey(key);
    try {
      if (options.versionId) {
        throw new StorageUnsupportedOperationError(
          'The local driver does not support versioning',
        );
      }
      const absolute = this.resolveKey(normalized);
      const stats = await fs.stat(absolute);

      const range = options.range;
      const stream = createReadStream(absolute, {
        ...(range
          ? {
              start: range.offset,
              end:
                range.length !== undefined
                  ? range.offset + range.length - 1
                  : undefined,
            }
          : {}),
        encoding: options.native?.encoding,
        signal: options.signal,
      } as Parameters<typeof createReadStream>[1]);

      const contentLength = range
        ? Math.min(
            stats.size - range.offset,
            range.length ?? Number.MAX_SAFE_INTEGER,
          )
        : stats.size;

      return {
        stream,
        contentType: detectContentTypeFromPath(normalized) ?? DEFAULT_CONTENT_TYPE,
        contentLength,
        lastModified: stats.mtime,
        provider: 'local',
        native: { absolutePath: absolute },
        buffer: () => streamToBuffer(stream),
        text: () => streamToBuffer(stream).then((b) => b.toString('utf8')),
        json: <V,>() =>
          streamToBuffer(stream).then((b) => JSON.parse(b.toString('utf8')) as V),
      } as unknown as DownloadResult<'local'>;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'download', normalized);
    }
  }

  async delete(key: string, options: DeleteOptions<'local'> = {}): Promise<void> {
    const normalized = normalizeKey(key);
    try {
      if (options.versionId) {
        throw new StorageUnsupportedOperationError(
          'The local driver does not support versioning',
        );
      }
      await fs.unlink(this.resolveKey(normalized));

      if (options.native?.cleanEmptyParents) {
        let dir = path.dirname(this.resolveKey(normalized));
        while (dir.startsWith(this.root) && dir !== this.root) {
          const entries = await fs.readdir(dir).catch(() => null);
          if (entries === null || entries.length > 0) break;
          await fs.rmdir(dir).catch(() => undefined);
          dir = path.dirname(dir);
        }
      }
    } catch (error) {
      // Deleting a missing object is a no-op, matching object-store semantics.
      if (isMissingError(error)) return;
      if (error instanceof StorageError) throw error;
      this.fail(error, 'delete', normalized);
    }
  }

  async deleteMany(
    keys: string[],
    options: DeleteManyOptions<'local'> = {},
  ): Promise<DeleteManyResult> {
    const settled = await Promise.allSettled(
      keys.map((key) => this.delete(key, options as DeleteOptions<'local'>)),
    );
    const deleted: string[] = [];
    const failed: DeleteManyResult['failed'] = [];
    settled.forEach((result, index) => {
      const key = keys[index];
      if (result.status === 'fulfilled') deleted.push(key);
      else failed.push({ path: key, error: result.reason });
    });
    return { deleted, failed };
  }

  async exists(key: string, _options: ExistsOptions<'local'> = {}): Promise<boolean> {
    const normalized = normalizeKey(key);
    try {
      await fs.access(this.resolveKey(normalized), fs.constants.F_OK);
      return true;
    } catch (error) {
      if (isMissingError(error)) return false;
      this.fail(error, 'exists', normalized);
    }
  }

  async stat(
    key: string,
    options: StatOptions<'local'> = {},
  ): Promise<FileStat<'local'>> {
    const normalized = normalizeKey(key);
    try {
      if (options.versionId) {
        throw new StorageUnsupportedOperationError(
          'The local driver does not support versioning',
        );
      }
      const absolute = this.resolveKey(normalized);
      const stats =
        options.native?.followSymlinks === true
          ? await fs.stat(absolute)
          : await fs.lstat(absolute);
      return {
        path: normalized,
        size: stats.size,
        contentType:
          detectContentTypeFromPath(normalized) ?? DEFAULT_CONTENT_TYPE,
        lastModified: stats.mtime,
        provider: 'local',
        native: { stats },
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'stat', normalized);
    }
  }

  async list(options: ListOptions<'local'> = {}): Promise<ListResult<'local'>> {
    const limit = Math.max(1, options.limit ?? 1000);
    const recursive = options.recursive ?? false;
    const followSymlinks =
      options.native?.followSymlinks ?? this.config.followSymlinks ?? false;

    const internalPrefix = joinKey(this.prefix, options.prefix ?? '');
    const baseDir = internalPrefix ? resolveInsideRoot(this.root, internalPrefix) : this.root;
    const basePrefix = internalPrefix;

    const files: StorageFile[] = [];
    const directories: string[] = [];
    let cursor: string | undefined;
    let hasMore = false;
    let emitted = 0;
    const skipUntil = options.cursor;

    const visit = (entry: Entry): boolean => {
      if (skipUntil && sortKeyOf(entry.key) <= sortKeyOf(skipUntil)) return true;
      if (emitted >= limit) {
        hasMore = true;
        return false;
      }
      emitted += 1;
      cursor = entry.key;
      if (entry.isDirectory) {
        directories.push(stripKey(this.prefix, entry.key));
      } else {
        files.push({
          path: stripKey(this.prefix, entry.key),
          size: entry.size,
          lastModified: entry.lastModified,
        });
      }
      return true;
    };

    try {
      await fs.access(baseDir);
    } catch {
      return { files: [], directories: [], hasMore: false };
    }

    try {
      if (recursive) {
        await this.walk(baseDir, basePrefix, visit, followSymlinks, 0);
      } else {
        const dirents = await fs.readdir(baseDir, { withFileTypes: true });
        const entries: Entry[] = [];
        for (const dirent of dirents) {
          const entry = await this.toEntry(
            baseDir,
            basePrefix,
            dirent.name,
            dirent.isDirectory(),
            dirent.isSymbolicLink() && followSymlinks,
            followSymlinks,
          );
          entries.push(entry);
        }
        entries.sort((a, b) => sortKeyOf(a.key).localeCompare(sortKeyOf(b.key)));
        for (const entry of entries) {
          if (!visit(entry)) break;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOTDIR') {
        return { files: [], directories: [], hasMore: false };
      }
      this.fail(error, 'list');
    }

    return {
      files,
      directories,
      cursor: hasMore ? cursor : undefined,
      hasMore,
      native: { root: this.root },
    };
  }

  private async toEntry(
    dir: string,
    dirPrefix: string,
    name: string,
    isDir: boolean,
    treatAsDir: boolean,
    followSymlinks: boolean,
  ): Promise<Entry> {
    const directory = isDir || treatAsDir;
    const cleanPrefix = dirPrefix.replace(/\/+$/, '');
    const key = `${cleanPrefix ? `${cleanPrefix}/` : ''}${name}${directory ? '/' : ''}`;
    let size: number | undefined;
    let lastModified: Date | undefined;
    try {
      const stats = followSymlinks
        ? await fs.stat(path.join(dir, name))
        : await fs.lstat(path.join(dir, name));
      size = stats.size;
      lastModified = stats.mtime;
    } catch {
      /* dangling symlink */
    }
    return { key, name, isDirectory: directory, size, lastModified };
  }

  private async walk(
    dir: string,
    dirPrefix: string,
    visit: (entry: Entry) => boolean,
    followSymlinks: boolean,
    depth: number,
  ): Promise<void> {
    if (depth > 100) return; // guard against symlink loops
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const entries: Entry[] = [];
    for (const dirent of dirents) {
      const entry = await this.toEntry(
        dir,
        dirPrefix,
        dirent.name,
        dirent.isDirectory(),
        followSymlinks && dirent.isSymbolicLink(),
        followSymlinks,
      );
      entries.push(entry);
    }
    entries.sort((a, b) => sortKeyOf(a.key).localeCompare(sortKeyOf(b.key)));

    for (const entry of entries) {
      if (!visit(entry)) return;
      if (entry.isDirectory) {
        await this.walk(
          path.join(dir, entry.name),
          entry.key.replace(/\/$/, ''),
          visit,
          followSymlinks,
          depth + 1,
        );
      }
    }
  }

  async copy(
    source: string,
    destination: string,
    options: CopyOptions<'local'> = {},
  ): Promise<{ source: string; destination: string; lastModified?: Date }> {
    const src = normalizeKey(source);
    const dest = normalizeKey(destination);
    try {
      await this.assertOverwriteAllowed(dest, options.overwrite ?? true);
      const destAbs = this.resolveKey(dest);
      await fs.mkdir(path.dirname(destAbs), this.mkdirOptions());
      await fs.copyFile(this.resolveKey(src), destAbs);
      const stats = await fs.stat(destAbs);
      return { source: src, destination: dest, lastModified: stats.mtime };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'copy', src);
    }
  }

  async move(
    source: string,
    destination: string,
    options: MoveOptions<'local'> = {},
  ): Promise<{ source: string; destination: string }> {
    const src = normalizeKey(source);
    const dest = normalizeKey(destination);
    try {
      await this.assertOverwriteAllowed(dest, options.overwrite ?? true);
      const srcAbs = this.resolveKey(src);
      const destAbs = this.resolveKey(dest);
      await fs.mkdir(path.dirname(destAbs), this.mkdirOptions());
      try {
        await fs.rename(srcAbs, destAbs);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
          await fs.copyFile(srcAbs, destAbs);
          await fs.unlink(srcAbs);
        } else {
          throw error;
        }
      }
      return { source: src, destination: dest };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'move', src);
    }
  }

  async getUrl(key: string, options: UrlOptions<'local'> = {}): Promise<string> {
    const normalized = normalizeKey(key);
    if (options.native?.fileUrl) {
      return pathToFileURL(this.resolveKey(normalized)).toString();
    }
    if (!this.config.baseUrl) {
      throw new StorageUnsupportedOperationError(
        'getUrl() requires `baseUrl` in the local storage config (or use native: { fileUrl: true })',
      );
    }
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}/${encodeKeyPath(joinKey(this.prefix, normalized))}`;
  }

  async getSignedUrl(
    _key: string,
    _options?: SignedUrlOptions<'local'>,
  ): Promise<string> {
    throw new StorageUnsupportedOperationError(
      'The local driver does not support signed URLs. Serve files through your own application.',
    );
  }
}


