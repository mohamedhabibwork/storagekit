import { Readable } from 'node:stream';

import {
  StorageConflictError,
  StorageError,
  StorageInvalidConfigError,
  StorageNotFoundError,
  StorageUnsupportedOperationError,
  isStorageError,
  normalizeError,
} from '../../core/errors';
import { detectContentTypeFromPath } from '../../core/mime';
import { joinKey, normalizeKey, stripKey } from '../../core/paths';
import { bodyLength, streamToBuffer, toReadable } from '../../core/streams';
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
import type { MapValueFor, NativeClientMap } from '../../core/maps';
import type { StorageDriver } from '../driver';
import type { GcsStorageConfig } from './gcs.types';

type GcsSdk = typeof import('@google-cloud/storage');
type GcsStorage = import('@google-cloud/storage').Storage;
type GcsFile = import('@google-cloud/storage').File;
type GcsFileMetadata = import('@google-cloud/storage').FileMetadata;

let sdkPromise: Promise<GcsSdk> | undefined;

async function loadGcsSdk(): Promise<GcsSdk> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      try {
        return (await import('@google-cloud/storage')) as unknown as GcsSdk;
      } catch (error) {
        sdkPromise = undefined;
        throw new StorageInvalidConfigError(
          'The GCS driver requires the official @google-cloud/storage client. Install it with:\n' +
            'npm install @google-cloud/storage',
          { cause: error },
        );
      }
    })();
  }
  return sdkPromise;
}

export interface GcsDriverRuntimeOptions {
  detectContentType?: boolean;
}

const MAX_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Google Cloud Storage driver. Backed by the official `@google-cloud/storage`
 * client; speaks the GCS REST API. See `docs/gcs.md` for the upstream
 * protocol reference and local-dev emulator setup.
 */
export class GcsDriver implements StorageDriver<'gcs'> {
  readonly type = 'gcs' as const;

  private readonly config: GcsStorageConfig;
  private readonly runtime: GcsDriverRuntimeOptions;
  private readonly prefix?: string;
  private client: GcsStorage | undefined;

  constructor(config: GcsStorageConfig, runtime: GcsDriverRuntimeOptions = {}) {
    this.config = config;
    this.runtime = runtime;
    this.prefix = config.prefix?.replace(/\/+$/, '') || undefined;
    if (this.prefix) normalizeKey(this.prefix);
  }

  /** Load the SDK and build the underlying `Storage` client. Awaited by the factory. */
  async ready(): Promise<this> {
    if (!this.client) {
      await loadGcsSdk();
      this.client =
        this.config.client ??
        new (await loadGcsSdk()).Storage({
          ...(this.config.projectId !== undefined ? { projectId: this.config.projectId } : {}),
          ...(this.config.keyFilename !== undefined ? { keyFilename: this.config.keyFilename } : {}),
          ...(this.config.credentials !== undefined ? { credentials: this.config.credentials } : {}),
          ...(this.config.apiEndpoint !== undefined ? { apiEndpoint: this.config.apiEndpoint } : {}),
          ...(this.config.retryOptions !== undefined ? { retryOptions: this.config.retryOptions } : {}),
          ...(this.config.clientOptions ?? {}),
        });
    }
    return this;
  }

  private requireClient(): GcsStorage {
    if (!this.client) {
      throw new StorageInvalidConfigError(
        'GCS driver is not initialized; await driver.ready() or use createStorage()',
      );
    }
    return this.client;
  }

  private file(path: string): GcsFile {
    return this.requireClient().bucket(this.config.bucket).file(path);
  }

  private key(path: string): string {
    return joinKey(this.prefix, normalizeKey(path));
  }

  capabilities(): StorageCapabilities {
    return {
      signedUrls: true,
      multipartUpload: true, // GCS resumable uploads
      serverSideCopy: true,
      versioning: true,
      metadata: true,
      directories: false,
      bulkDelete: false,
    };
  }

  async upload(
    path: string,
    body: UploadBody,
    options: UploadOptions<'gcs'> = {},
  ): Promise<UploadResult<'gcs'>> {
    const normalized = normalizeKey(path);
    const key = this.key(normalized);
    try {
      await this.ready();
      if (options.overwrite === false) {
        await this.assertAbsent(normalized, key);
      }

      const contentType =
        options.contentType ??
        (this.runtime.detectContentType !== false
          ? detectContentTypeFromPath(normalized)
          : undefined);

      const stream = this.file(key).createWriteStream({
        ...(contentType !== undefined ? { contentType } : {}),
        ...(options.cacheControl !== undefined ? { cacheControl: options.cacheControl } : {}),
        ...(options.contentEncoding !== undefined
          ? { contentEncoding: options.contentEncoding }
          : {}),
        ...(options.contentDisposition !== undefined
          ? { contentDisposition: options.contentDisposition }
          : {}),
        ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
        resumable: true,
        ...this.nativeOptions(options.native),
      });

      const source = toReadable(body);
      try {
        await pipelinePromisify(source, stream);
      } catch (error) {
        // If the destination already exists, surface that as a conflict.
        if (this.isPreconditionFailed(error)) {
          throw new StorageConflictError(
            `"${normalized}" already exists and overwrite is disabled`,
            { provider: 'gcs', path: normalized },
          );
        }
        throw error;
      }

      const [metadata] = await this.file(key).getMetadata();
      const url = await this.getUrl(normalized).catch(() => undefined);

      return {
        path: normalized,
        size: bodyLength(body),
        etag: extractEtag(metadata),
        versionId: stringify(metadata.generation),
        url,
        provider: 'gcs',
        native: metadata,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw normalizeError(error, { provider: 'gcs', operation: 'upload', path: normalized });
    }
  }

  async download(
    path: string,
    options: DownloadOptions<'gcs'> = {},
  ): Promise<DownloadResult<'gcs'>> {
    const normalized = normalizeKey(path);
    const key = this.key(normalized);
    try {
      await this.ready();
      const generation = options.versionId ?? (options.native?.generation as string | number | undefined);
      const streamOpts: import('@google-cloud/storage').CreateReadStreamOptions = {
        ...(options.native ?? {}),
        ...(generation !== undefined ? { generation } : {}),
      };
      if (options.range !== undefined) {
        const length = options.range.length ?? Number.MAX_SAFE_INTEGER;
        streamOpts.start = options.range.offset;
        streamOpts.end = options.range.offset + length - 1;
      }
      const stream = this.file(key).createReadStream(streamOpts);

      const [metadata] = await this.file(key).getMetadata({
        ...(generation !== undefined ? { generation } : {}),
      });

      const download: DownloadResult<'gcs'> = {
        stream,
        contentType: metadata.contentType ?? undefined,
        contentLength: numericSize(metadata.size),
        etag: extractEtag(metadata),
        lastModified: metadata.updated ? new Date(metadata.updated) : undefined,
        metadata: stringifyUserMetadata(metadata.metadata),
        versionId: stringify(metadata.generation),
        provider: 'gcs',
        native: metadata as GcsFileMetadata,
        buffer: () => streamToBuffer(stream),
        text: () => streamToBuffer(stream).then((b) => b.toString('utf8')),
        json: <V,>() => streamToBuffer(stream).then((b) => JSON.parse(b.toString('utf8')) as V),
      };
      return download;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (isMissing(error)) {
        throw new StorageNotFoundError(`"${normalized}" not found`, {
          provider: 'gcs',
          operation: 'download',
          path: normalized,
        });
      }
      throw normalizeError(error, { provider: 'gcs', operation: 'download', path: normalized });
    }
  }

  async delete(path: string, options: DeleteOptions<'gcs'> = {}): Promise<void> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      await this.file(this.key(normalized)).delete({
        ...(options.native ?? {}),
        ...(options.versionId !== undefined ? { generation: options.versionId } : {}),
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      // GCS `delete` returns success even for missing objects — but if
      // versionId is specified and does not match, we surface a 404.
      if (isMissing(error)) return;
      throw normalizeError(error, { provider: 'gcs', operation: 'delete', path: normalized });
    }
  }

  async deleteMany(
    paths: string[],
    _options: DeleteManyOptions<'gcs'> = {},
  ): Promise<DeleteManyResult> {
    await this.ready();
    const originals = paths.map((p) => normalizeKey(p));
    const settled = await Promise.allSettled(
      originals.map((original) => this.delete(original)),
    );
    const deleted: string[] = [];
    const failed: DeleteManyResult['failed'] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') deleted.push(originals[index]);
      else {
        failed.push({
          path: originals[index],
          error: isStorageError(result.reason)
            ? result.reason
            : normalizeError(result.reason, {
                provider: 'gcs',
                operation: 'deleteMany',
                path: originals[index],
              }),
        });
      }
    });
    return { deleted, failed };
  }

  async exists(path: string, _options: ExistsOptions<'gcs'> = {}): Promise<boolean> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const [exists] = await this.file(this.key(normalized)).exists();
      return exists;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw normalizeError(error, { provider: 'gcs', operation: 'exists', path: normalized });
    }
  }

  async stat(path: string, options: StatOptions<'gcs'> = {}): Promise<FileStat<'gcs'>> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const generation = options.versionId ?? (options.native?.generation as string | number | undefined);
      const [metadata] = await this.file(this.key(normalized)).getMetadata({
        ...(generation !== undefined ? { generation } : {}),
      });
      return {
        path: normalized,
        size: numericSize(metadata.size) ?? 0,
        contentType: metadata.contentType ?? undefined,
        etag: extractEtag(metadata),
        lastModified: metadata.updated ? new Date(metadata.updated) : undefined,
        metadata: stringifyUserMetadata(metadata.metadata),
        versionId: stringify(metadata.generation),
        provider: 'gcs',
        native: metadata,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (isMissing(error)) {
        throw new StorageNotFoundError(`"${normalized}" not found`, {
          provider: 'gcs',
          operation: 'stat',
          path: normalized,
        });
      }
      throw normalizeError(error, { provider: 'gcs', operation: 'stat', path: normalized });
    }
  }

  async list(options: ListOptions<'gcs'> = {}): Promise<ListResult<'gcs'>> {
    const limit = Math.min(1000, Math.max(1, options.limit ?? 1000));
    try {
      await this.ready();
      const bucket = this.requireClient().bucket(this.config.bucket);
      const response = (await bucket.getFiles({
        prefix: joinKey(this.prefix, options.prefix ?? ''),
        delimiter: options.recursive ? '' : '/',
        maxResults: limit,
        pageToken: options.cursor,
        ...(options.native ?? {}),
      })) as [GcsFile[], { pageToken?: string; prefixes?: string[] } | undefined, unknown];

      const [files, nextQuery] = response;
      const resultFiles: StorageFile[] = [];
      const directories: string[] = [];
      for (const f of files) {
        resultFiles.push({
          path: stripKey(this.prefix, f.name),
          size: numericSize(f.metadata.size),
          etag: extractEtag(f.metadata),
          lastModified: f.metadata.updated ? new Date(f.metadata.updated) : undefined,
        });
      }
      if (nextQuery?.prefixes) {
        for (const prefix of nextQuery.prefixes) {
          directories.push(stripKey(this.prefix, prefix));
        }
      }
      return {
        files: resultFiles,
        directories,
        cursor: nextQuery?.pageToken,
        hasMore: Boolean(nextQuery?.pageToken),
        native: files.map((f) => f.metadata),
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw normalizeError(error, { provider: 'gcs', operation: 'list' });
    }
  }

  async copy(
    source: string,
    destination: string,
    options: CopyOptions<'gcs'> = {},
  ): Promise<{ source: string; destination: string; etag?: string; lastModified?: Date }> {
    const src = normalizeKey(source);
    const dest = normalizeKey(destination);
    try {
      await this.ready();
      if (options.overwrite === false) {
        await this.assertAbsent(dest, this.key(dest));
      }
      const srcKey = this.key(src);
      const destKey = this.key(dest);
      const sourceGeneration = options.native?.preconditionOpts?.ifGenerationMatch;
      const [destinationFile] = (await this.file(srcKey).copy(this.file(destKey), {
        ...(options.contentType !== undefined ? { contentType: options.contentType } : {}),
        ...(options.cacheControl !== undefined ? { cacheControl: options.cacheControl } : {}),
        ...(options.contentEncoding !== undefined ? { contentEncoding: options.contentEncoding } : {}),
        ...(options.contentDisposition !== undefined
          ? { contentDisposition: options.contentDisposition }
          : {}),
        ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
        ...(options.native ?? {}),
        ...(sourceGeneration !== undefined ? { generation: sourceGeneration } : {}),
      })) as [GcsFile, unknown];

      return {
        source: src,
        destination: dest,
        etag: extractEtag(destinationFile.metadata),
        lastModified: destinationFile.metadata.updated
          ? new Date(destinationFile.metadata.updated)
          : undefined,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (this.isPreconditionFailed(error)) {
        throw new StorageConflictError(
          `"${dest}" already exists and overwrite is disabled`,
          { provider: 'gcs', path: dest },
        );
      }
      throw normalizeError(error, { provider: 'gcs', operation: 'copy', path: src });
    }
  }

  async move(
    source: string,
    destination: string,
    options: MoveOptions<'gcs'> = {},
  ): Promise<{ source: string; destination: string; etag?: string }> {
    const src = normalizeKey(source);
    const dest = normalizeKey(destination);
    try {
      await this.ready();
      if (options.overwrite === false) {
        await this.assertAbsent(dest, this.key(dest));
      }
      const moved = (await this.file(this.key(src)).move(this.key(dest), {
        ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
        ...(options.native ?? {}),
      })) as unknown as [GcsFile] | undefined;
      const movedFile = Array.isArray(moved) ? moved[0] : undefined;
      const metadata = movedFile?.metadata;
      return {
        source: src,
        destination: dest,
        etag: metadata ? extractEtag(metadata) : undefined,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (this.isPreconditionFailed(error)) {
        throw new StorageConflictError(
          `"${dest}" already exists and overwrite is disabled`,
          { provider: 'gcs', path: dest },
        );
      }
      throw normalizeError(error, { provider: 'gcs', operation: 'move', path: src });
    }
  }

  async getUrl(path: string, _options: UrlOptions<'gcs'> = {}): Promise<string> {
    const normalized = normalizeKey(path);
    if (this.config.publicUrlBase) {
      const base = this.config.publicUrlBase.replace(/\/+$/, '');
      return `${base}/${encodePath(this.key(normalized))}`;
    }
    const encodedBucket = encodeURIComponent(this.config.bucket);
    return `https://storage.googleapis.com/${encodedBucket}/${encodePath(this.key(normalized))}`;
  }

  async getSignedUrl(path: string, options: SignedUrlOptions<'gcs'> = {}): Promise<string> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const expiresIn = validateExpiry(options.expiresIn);
      const expiresAt = Date.now() + expiresIn * 1000;
      const action = options.action ?? 'read';
      const mapAction =
        action === 'read'
          ? 'read'
          : action === 'write'
            ? 'write'
            : action === 'delete'
              ? 'delete'
              : (() => {
                  throw new StorageUnsupportedOperationError(
                    `GCS signed URLs do not support action "${action}"`,
                    { provider: 'gcs', operation: 'getSignedUrl', path: normalized },
                  );
                })();
      const [url] = await this.file(this.key(normalized)).getSignedUrl({
        action: mapAction,
        version: options.native?.version ?? 'v4',
        expires: expiresAt,
        ...(options.native ?? {}),
      });
      return url;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw normalizeError(error, { provider: 'gcs', operation: 'getSignedUrl', path: normalized });
    }
  }

  /** The underlying `Storage` client — escape hatch for SDK calls we do not wrap. */
  native(): MapValueFor<NativeClientMap, 'gcs'> {
    return this.requireClient() as MapValueFor<NativeClientMap, 'gcs'>;
  }

  async nativeRequest<R>(
    fn: (client: MapValueFor<NativeClientMap, 'gcs'>) => Promise<R>,
  ): Promise<R> {
    return fn(this.requireClient() as MapValueFor<NativeClientMap, 'gcs'>);
  }

  // ---------- helpers ----------

  private async assertAbsent(normalized: string, key: string): Promise<void> {
    try {
      const [exists] = await this.file(key).exists();
      if (!exists) return;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw normalizeError(error, { provider: 'gcs', operation: 'upload', path: normalized });
    }
    throw new StorageConflictError(
      `"${normalized}" already exists and overwrite is disabled`,
      { provider: 'gcs', path: normalized },
    );
  }

  private nativeOptions(
    native: UploadOptions<'gcs'>['native'],
  ): Record<string, unknown> {
    if (!native) return {};
    const out: Record<string, unknown> = { ...native };
    if (native.predefinedAcl) out.predefinedAcl = native.predefinedAcl;
    if (native.kmsKeyName) out.kmsKeyName = native.kmsKeyName;
    return out;
  }

  private isPreconditionFailed(error: unknown): boolean {
    const code = (error as { code?: number | string }).code;
    return code === 412 || code === '412' || code === 'PRECONDITION_FAILED';
  }
}

// ---------- pure helpers (testable) ----------

function validateExpiry(expiresIn: number | undefined): number {
  const value = expiresIn ?? 3600;
  if (!Number.isFinite(value) || value < 1 || value > MAX_SIGNED_URL_SECONDS) {
    throw new StorageUnsupportedOperationError(
      `expiresIn must be between 1 and ${MAX_SIGNED_URL_SECONDS} seconds (7 days), got ${expiresIn}`,
      { code: 'INVALID_SIGNED_URL_EXPIRY' },
    );
  }
  return Math.floor(value);
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: number | string }).code;
  return code === 404 || code === '404' || code === 'NOT_FOUND';
}

function stringify(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function numericSize(value: string | number | bigint | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'bigint') return Number(value);
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : undefined;
}

function extractEtag(metadata: GcsFileMetadata): string | undefined {
  if (!metadata) return undefined;
  if (typeof metadata.etag === 'string' && metadata.etag.length > 0) return metadata.etag;
  if (typeof metadata.md5Hash === 'string' && metadata.md5Hash.length > 0) {
    return metadata.md5Hash;
  }
  if (typeof metadata.crc32c === 'string' && metadata.crc32c.length > 0) {
    return metadata.crc32c;
  }
  return undefined;
}

function stringifyUserMetadata(
  metadata: GcsFileMetadata['metadata'],
): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata).filter(
    ([, v]) => v !== undefined && v !== null,
  ) as [string, string | number | boolean][];
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([k, v]) => [k, String(v)]));
}

function encodePath(key: string): string {
  // GCS object paths can contain '/'; encode each segment but leave slashes
  // intact so the URL stays human-readable.
  return key.split('/').map(encodeURIComponent).join('/');
}

/**
 * `pipeline()` from `node:stream/promises` is the right primitive here:
 * pipes the body into GCS's createWriteStream and rejects when the
 * destination stream errors. We re-implement (rather than import) to keep
 * the driver self-contained and avoid adding another top-level dep.
 */
function pipelinePromisify(source: Readable, dest: NodeJS.WritableStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    source.on('error', reject);
    dest.on('error', reject);
    dest.on('finish', () => resolve());
    source.pipe(dest);
  });
}
