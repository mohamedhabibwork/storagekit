import {
  StorageConflictError,
  StorageError,
  StorageInvalidConfigError,
  StorageUnsupportedOperationError,
  normalizeError,
} from '../../core/errors';
import { detectContentTypeFromPath } from '../../core/mime';
import {
  encodeKeyPath,
  joinKey,
  normalizeKey,
  stripKey,
} from '../../core/paths';
import { bodyLength } from '../../core/streams';
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
import type * as Minio from 'minio';

import type { MinioStorageConfig } from './minio.types';
import type { StorageDriver } from '../driver';

type MinioSdk = typeof Minio;



let sdkPromise: Promise<MinioSdk> | undefined;

async function loadMinioSdk(): Promise<MinioSdk> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      try {
        const mod = await import('minio');
        return mod as unknown as MinioSdk;
      } catch (error) {
        sdkPromise = undefined;
        throw new StorageInvalidConfigError(
          'The MinIO driver requires the official minio client. Install it with:\n' +
            'npm install minio',
          { cause: error },
        );
      }
    })();
  }
  return sdkPromise;
}

export interface MinioDriverRuntimeOptions {
  detectContentType?: boolean;
}

interface BucketItemInternal {
  name?: string;
  prefix?: string;
  size?: number;
  etag?: string;
  lastModified?: Date;
}

const MAX_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;

export class MinioDriver implements StorageDriver<'minio'> {
  readonly type = 'minio' as const;

  private readonly config: MinioStorageConfig;
  private readonly runtime: MinioDriverRuntimeOptions;
  private readonly prefix?: string;
  private client: Minio.Client | undefined;
  private sdk: MinioSdk | undefined;

  constructor(config: MinioStorageConfig, runtime: MinioDriverRuntimeOptions = {}) {
    this.config = config;
    this.runtime = runtime;
    this.prefix = config.prefix?.replace(/\/+$/, '') || undefined;
    if (this.prefix) normalizeKey(this.prefix);
  }

  async ready(): Promise<this> {
    if (!this.client) {
      const sdk = await loadMinioSdk();
      this.sdk = sdk;
      this.client =
        this.config.client ??
        new sdk.Client({
          endPoint: this.config.endPoint,
          ...(this.config.port !== undefined ? { port: this.config.port } : {}),
          ...(this.config.useSSL !== undefined ? { useSSL: this.config.useSSL } : {}),
          ...(this.config.accessKey !== undefined ? { accessKey: this.config.accessKey } : {}),
          ...(this.config.secretKey !== undefined ? { secretKey: this.config.secretKey } : {}),
          ...(this.config.region !== undefined ? { region: this.config.region } : {}),
          ...this.config.clientOptions,
        });
    }
    return this;
  }

  private requireClient(): Minio.Client {
    if (!this.client) {
      throw new StorageInvalidConfigError(
        'MinIO driver is not initialized; await driver.ready() or use createStorage()',
      );
    }
    return this.client;
  }

  native(): Minio.Client {
    return this.requireClient();
  }

  nativeRequest<R>(fn: (client: Minio.Client) => Promise<R>): Promise<R> {
    return fn(this.requireClient());
  }

  capabilities(): StorageCapabilities {
    return {
      signedUrls: true,
      multipartUpload: true,
      serverSideCopy: true,
      versioning: true,
      metadata: true,
      directories: false,
      bulkDelete: true,
    };
  }

  private key(key: string): string {
    return joinKey(this.prefix, normalizeKey(key));
  }

  private fail(error: unknown, operation: string, path?: string): never {
    throw normalizeError(error, { provider: 'minio', operation, path });
  }

  private buildMetaData(
    key: string,
    options: UploadOptions<'minio'>,
  ): Record<string, string> {
    const metaData: Record<string, string> = {};
    const contentType =
      options.contentType ??
      (this.runtime.detectContentType !== false
        ? detectContentTypeFromPath(key)
        : undefined);
    if (contentType !== undefined) metaData['Content-Type'] = contentType;
    if (options.cacheControl !== undefined) metaData['Cache-Control'] = options.cacheControl;
    if (options.contentDisposition !== undefined)
      metaData['Content-Disposition'] = options.contentDisposition;
    if (options.contentEncoding !== undefined)
      metaData['Content-Encoding'] = options.contentEncoding;
    if (options.metadata !== undefined) Object.assign(metaData, options.metadata);
    if (options.native?.metaData !== undefined) {
      Object.assign(metaData, options.native.metaData);
    }
    return metaData;
  }

  async upload(
    path: string,
    body: UploadBody,
    options: UploadOptions<'minio'> = {},
  ): Promise<UploadResult<'minio'>> {
    const normalized = normalizeKey(path);
    const key = this.key(normalized);
    try {
      await this.ready();
      const client = this.requireClient();

      if (options.overwrite === false) {
        await this.assertAbsent(normalized, key);
      }

      const metaData = this.buildMetaData(normalized, options);

      let result: { etag: string; versionId: string | null };
      if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
        result = await client.putObject(
          this.config.bucket,
          key,
          buffer,
          buffer.length,
          metaData,
        );
      } else if (typeof body === 'string') {
        const buffer = Buffer.from(body, 'utf8');
        result = await client.putObject(
          this.config.bucket,
          key,
          buffer,
          buffer.length,
          metaData,
        );
      } else if (body instanceof ArrayBuffer) {
        const buffer = Buffer.from(body);
        result = await client.putObject(
          this.config.bucket,
          key,
          buffer,
          buffer.length,
          metaData,
        );
      } else if (typeof Blob !== 'undefined' && body instanceof Blob) {
        const buffer = Buffer.from(await body.arrayBuffer());
        result = await client.putObject(
          this.config.bucket,
          key,
          buffer,
          buffer.length,
          metaData,
        );
      } else {
        // Readable stream — size unknown means MinIO uses its native
        // multipart machinery automatically.
        result = await client.putObject(
          this.config.bucket,
          key,
          body as never,
          undefined,
          metaData,
        );
      }

      let url: string | undefined;
      try {
        url = await this.getUrl(normalized);
      } catch {
        url = undefined;
      }

      return {
        path: normalized,
        size: bodyLength(body),
        etag: result.etag,
        versionId: result.versionId ?? undefined,
        url,
        provider: 'minio',
        native: result,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'upload', normalized);
    }
  }

  private async assertAbsent(normalized: string, key: string): Promise<void> {
    try {
      await this.requireClient().statObject(this.config.bucket, key);
    } catch (error) {
      if (isMissing(error)) return;
      this.fail(error, 'upload', normalized);
    }
    throw new StorageConflictError(
      `"${normalized}" already exists and overwrite is disabled`,
      { provider: 'minio', path: normalized },
    );
  }

  async download(
    path: string,
    options: DownloadOptions<'minio'> = {},
  ): Promise<DownloadResult<'minio'>> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const client = this.requireClient();
      const getOpts: Record<string, unknown> = { ...options.native };
      if (options.versionId) getOpts.versionId = options.versionId;

      const stream =
        options.range !== undefined
          ? await client.getPartialObject(
              this.config.bucket,
              this.key(normalized),
              options.range.offset,
              options.range.length,
              getOpts as never,
            )
          : await client.getObject(
              this.config.bucket,
              this.key(normalized),
              getOpts as never,
            );

      return {
        stream,
        provider: 'minio',
        native: {},
        buffer: () => import('../../core/streams.js').then((m) => m.streamToBuffer(stream)),
        text: () =>
          import('../../core/streams.js').then(async (m) =>
            (await m.streamToBuffer(stream)).toString('utf8'),
          ),
        json: <V,>() =>
          import('../../core/streams.js').then(async (m) =>
            JSON.parse((await m.streamToBuffer(stream)).toString('utf8')) as V,
          ),
      } as unknown as DownloadResult<'minio'>;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'download', normalized);
    }
  }

  async delete(path: string, options: DeleteOptions<'minio'> = {}): Promise<void> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const removeOpts: Record<string, unknown> = { ...options.native };
      if (options.versionId) removeOpts.versionId = options.versionId;
      await this.requireClient().removeObject(
        this.config.bucket,
        this.key(normalized),
        removeOpts as never,
      );
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'delete', normalized);
    }
  }

  async deleteMany(
    paths: string[],
    options: DeleteManyOptions<'minio'> = {},
  ): Promise<DeleteManyResult> {
    await this.ready();
    const client = this.requireClient();
    const originals = paths.map((p) => normalizeKey(p));
    try {
      const responses = await client.removeObjects(
        this.config.bucket,
        originals.map((p) => this.key(p)),
      );
      const deleted: string[] = [];
      const failed: DeleteManyResult['failed'] = [];
      const failureByKey = new Map<string, { Code?: string; Message?: string; Key?: string }>();
      for (const response of responses ?? []) {
        if (!response) continue;
        const failure = (
          'Error' in response && response.Error ? response.Error : response
        ) as { Code?: string; Message?: string; Key?: string };
        if (failure.Key) {
          failureByKey.set(stripKey(this.prefix, failure.Key), failure);
        }
      }
      for (const original of originals) {
        const failure = failureByKey.get(original);
        if (failure) {
          failed.push({
            path: original,
            error: normalizeError(
              new Error(`${failure.Code ?? 'Error'}: ${failure.Message ?? 'delete failed'}`),
              { provider: 'minio', operation: 'deleteMany', path: original },
            ),
          });
        } else {
          deleted.push(original);
        }
      }
      return { deleted, failed };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      // The batch call failed as a whole; fall back to per-object deletes so
      // callers get per-path failure attribution.
      const settled = await Promise.allSettled(
        originals.map((original) => this.delete(original, options as DeleteOptions<'minio'>)),
      );
      const deleted: string[] = [];
      const failed: DeleteManyResult['failed'] = [];
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') deleted.push(originals[index]);
        else
          failed.push({
            path: originals[index],
            error: normalizeError(result.reason, {
              provider: 'minio',
              operation: 'deleteMany',
              path: originals[index],
            }),
          });
      });
      return { deleted, failed };
    }
  }

  async exists(path: string, _options: ExistsOptions<'minio'> = {}): Promise<boolean> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      await this.requireClient().statObject(this.config.bucket, this.key(normalized));
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      if (error instanceof StorageError) throw error;
      this.fail(error, 'exists', normalized);
    }
  }

  async stat(path: string, options: StatOptions<'minio'> = {}): Promise<FileStat<'minio'>> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const statOpts: Record<string, unknown> = { ...options.native };
      if (options.versionId) statOpts.versionId = options.versionId;
      const result = await this.requireClient().statObject(
        this.config.bucket,
        this.key(normalized),
        statOpts as never,
      );
      const metaData = (result.metaData ?? {}) as Record<string, unknown>;
      const contentType = lookupIgnoreCase(metaData, 'content-type');
      return {
        path: normalized,
        size: result.size,
        contentType: contentType !== undefined ? String(contentType) : undefined,
        etag: result.etag,
        lastModified: result.lastModified,
        metadata: stringifyValues(metaData),
        versionId: result.versionId ?? undefined,
        provider: 'minio',
        native: result,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'stat', normalized);
    }
  }

  async list(options: ListOptions<'minio'> = {}): Promise<ListResult<'minio'>> {
    const limit = Math.min(1000, Math.max(1, options.limit ?? 1000));
    try {
      await this.ready();
      const client = this.requireClient() as unknown as {
        listObjectsV2Query(
          bucket: string,
          prefix: string,
          continuationToken: string,
          delimiter: string,
          maxKeys: number,
          startAfter: string,
        ): Promise<{
          objects: BucketItemInternal[];
          isTruncated: boolean;
          nextContinuationToken?: string;
        }>;
      };
      const response = await client.listObjectsV2Query(
        this.config.bucket,
        joinKey(this.prefix, options.prefix ?? ''),
        options.cursor ?? '',
        options.recursive ? '' : '/',
        limit,
        '',
      );

      const files: StorageFile[] = [];
      const directories: string[] = [];
      for (const object of response.objects ?? []) {
        if (object.prefix !== undefined) {
          directories.push(stripKey(this.prefix, object.prefix));
        } else if (object.name !== undefined) {
          files.push({
            path: stripKey(this.prefix, object.name),
            size: object.size,
            etag: object.etag,
            lastModified: object.lastModified,
          });
        }
      }

      return {
        files,
        directories,
        cursor: response.isTruncated ? response.nextContinuationToken : undefined,
        hasMore: response.isTruncated,
        native: {},
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'list');
    }
  }

  async copy(
    source: string,
    destination: string,
    options: CopyOptions<'minio'> = {},
  ): Promise<{ source: string; destination: string; etag?: string; lastModified?: Date }> {
    const src = normalizeKey(source);
    const dest = normalizeKey(destination);
    try {
      await this.ready();
      if (options.overwrite === false) {
        await this.assertAbsent(dest, this.key(dest));
      }
      let conditions: Minio.CopyConditions | undefined;
      const native = options.native;
      if (native) {
        conditions = new this.sdk!.CopyConditions();
        if (native.matchETag !== undefined) conditions.setMatchETag(native.matchETag);
        if (native.matchETagExcept !== undefined)
          conditions.setMatchETagExcept(native.matchETagExcept);
        if (native.modifiedSince !== undefined) conditions.setModified(native.modifiedSince);
        if (native.unmodifiedSince !== undefined)
          conditions.setUnmodified(native.unmodifiedSince);
      }

      const result = await this.requireClient().copyObject(
        this.config.bucket,
        this.key(dest),
        `/${this.config.bucket}/${this.key(src)}`,
        conditions as never,
      );
      return {
        source: src,
        destination: dest,
        etag: (result as { etag?: string }).etag,
        lastModified: (result as { lastModified?: Date }).lastModified,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'copy', src);
    }
  }

  async move(
    source: string,
    destination: string,
    options: MoveOptions<'minio'> = {},
  ): Promise<{ source: string; destination: string; etag?: string }> {
    const copied = await this.copy(source, destination, options as CopyOptions<'minio'>);
    await this.delete(source, { signal: options.signal });
    return { source: normalizeKey(source), destination: copied.destination, etag: copied.etag };
  }

  async getUrl(path: string, _options: UrlOptions<'minio'> = {}): Promise<string> {
    const key = this.key(normalizeKey(path));
    if (this.config.publicUrlBase) {
      const base = this.config.publicUrlBase.replace(/\/+$/, '');
      return `${base}/${encodeKeyPath(key)}`;
    }
    const ssl = this.config.useSSL ?? true;
    const port = this.config.port ?? (ssl ? 443 : 80);
    const defaultPort = ssl ? 443 : 80;
    const host =
      port === defaultPort ? this.config.endPoint : `${this.config.endPoint}:${port}`;
    return `${ssl ? 'https' : 'http'}://${host}/${this.config.bucket}/${encodeKeyPath(key)}`;
  }

  async getSignedUrl(path: string, options: SignedUrlOptions<'minio'> = {}): Promise<string> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const client = this.requireClient();
      const expiresIn = validateExpiry(options.expiresIn);
      const key = this.key(normalized);
      if (options.action === 'delete') {
        return await client.presignedUrl('DELETE', this.config.bucket, key, expiresIn);
      }
      if (options.action === 'write') {
        return await client.presignedPutObject(this.config.bucket, key, expiresIn);
      }
      return await client.presignedGetObject(
        this.config.bucket,
        key,
        expiresIn,
        options.native?.responseHeaders as never,
        options.native?.requestDate,
      );
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'getSignedUrl', normalized);
    }
  }
}

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
  const code = (error as { code?: string }).code;
  return code === 'NoSuchKey' || code === 'NotFound' || code === 'NoSuchObject';
}

function lookupIgnoreCase(
  record: Record<string, unknown>,
  target: string,
): unknown {
  const direct = record[target];
  if (direct !== undefined) return direct;
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function stringifyValues(
  record: Record<string, unknown>,
): Record<string, string> | undefined {
  const entries = Object.entries(record);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([k, v]) => [k, String(v)]));
}
