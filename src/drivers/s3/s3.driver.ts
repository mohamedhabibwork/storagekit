import type * as AwsS3 from '@aws-sdk/client-s3';
import type * as AwsLibStorage from '@aws-sdk/lib-storage';
import type * as AwsPresigner from '@aws-sdk/s3-request-presigner';

import {
  StorageConflictError,
  StorageError,
  StorageInvalidConfigError,
  StorageUnsupportedOperationError,
  normalizeError,
} from '../../core/errors';
import { detectContentTypeFromPath } from '../../core/mime';
import {
  bodyLength,
  cleanEtag,
  streamToBuffer,
  toReadable,
} from '../../core/streams';
import {
  encodeKeyPath,
  joinKey,
  normalizeKey,
  stripKey,
} from '../../core/paths';
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
import type { S3StorageConfig } from './s3.types';
import type { StorageDriver } from '../driver';

type AwsSdkBundle = {
  client: typeof AwsS3;
  libStorage: typeof AwsLibStorage;
  presigner: typeof AwsPresigner;
};

let sdkPromise: Promise<AwsSdkBundle> | undefined;

async function loadAwsSdk(): Promise<AwsSdkBundle> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      try {
        const [client, libStorage, presigner] = await Promise.all([
          import('@aws-sdk/client-s3'),
          import('@aws-sdk/lib-storage'),
          import('@aws-sdk/s3-request-presigner'),
        ]);
        return {
          client: client as unknown as typeof AwsS3,
          libStorage: libStorage as unknown as typeof AwsLibStorage,
          presigner: presigner as unknown as typeof AwsPresigner,
        };
      } catch (error) {
        sdkPromise = undefined;
        throw new StorageInvalidConfigError(
          'The S3 driver requires the AWS SDK v3 packages. Install them with:\n' +
            'npm install @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner',
          { cause: error },
        );
      }
    })();
  }
  return sdkPromise;
}

export interface S3DriverRuntimeOptions {
  detectContentType?: boolean;
}

export const MAX_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;

export class S3Driver implements StorageDriver<'s3'> {
  readonly type = 's3' as const;

  private readonly config: S3StorageConfig;
  private readonly runtime: S3DriverRuntimeOptions;
  private readonly prefix?: string;
  private client: AwsS3.S3Client | undefined;
  private sdk: AwsSdkBundle | undefined;

  constructor(config: S3StorageConfig, runtime: S3DriverRuntimeOptions = {}) {
    this.config = config;
    this.runtime = runtime;
    this.prefix = config.prefix?.replace(/\/+$/, '') || undefined;
    if (this.prefix) normalizeKey(this.prefix);
  }

  /** Load the SDK and build the underlying client. Awaited by the factory. */
  async ready(): Promise<this> {
    if (!this.client) {
      const sdk = await loadAwsSdk();
      this.sdk = sdk;
      this.client =
        this.config.client ??
        new sdk.client.S3Client({
          ...(this.config.region !== undefined ? { region: this.config.region } : {}),
          ...(this.config.endpoint !== undefined ? { endpoint: this.config.endpoint } : {}),
          ...(this.config.credentials !== undefined
            ? { credentials: this.config.credentials }
            : {}),
          ...(this.config.forcePathStyle !== undefined
            ? { forcePathStyle: this.config.forcePathStyle }
            : {}),
          ...this.config.clientOptions,
        });
    }
    return this;
  }

  private requireClient(): AwsS3.S3Client {
    if (!this.client || !this.sdk) {
      throw new StorageInvalidConfigError(
        'S3 driver is not initialized; await driver.ready() or use createStorage()',
      );
    }
    return this.client;
  }

  native(): AwsS3.S3Client {
    return this.requireClient();
  }

  nativeRequest<R>(fn: (client: AwsS3.S3Client) => Promise<R>): Promise<R> {
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
    throw normalizeError(error, { provider: 's3', operation, path });
  }

  private contentTypeFor(
    key: string,
    explicit: string | undefined,
  ): string | undefined {
    return explicit ??
      (this.runtime.detectContentType !== false
        ? detectContentTypeFromPath(key)
        : undefined);
  }

  async upload(
    path: string,
    body: UploadBody,
    options: UploadOptions<'s3'> = {},
  ): Promise<UploadResult<'s3'>> {
    const normalized = normalizeKey(path);
    const key = this.key(normalized);
    try {
      await this.ready();
      const client = this.requireClient();
      const sdk = this.sdk!;

      if (options.overwrite === false) {
        await this.assertAbsent(normalized, key, options.signal);
      }

      const input = {
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ...options.native,
      } as AwsS3.PutObjectCommandInput;
      const contentType = this.contentTypeFor(normalized, options.contentType);
      if (contentType !== undefined) input.ContentType = contentType;
      if (options.contentLength !== undefined) input.ContentLength = options.contentLength;
      if (options.metadata !== undefined) input.Metadata = options.metadata;
      if (options.cacheControl !== undefined) input.CacheControl = options.cacheControl;
      if (options.contentDisposition !== undefined)
        input.ContentDisposition = options.contentDisposition;
      if (options.contentEncoding !== undefined)
        input.ContentEncoding = options.contentEncoding;

      let abortController: AbortController | undefined;
      if (options.signal) {
        abortController = new AbortController();
        const relay = () => abortController?.abort(options.signal?.reason);
        if (options.signal.aborted) relay();
        else options.signal.addEventListener('abort', relay, { once: true });
      }

      const upload = new sdk.libStorage.Upload({
        client,
        params: input,
        ...(options.multipart?.partSize !== undefined
          ? { partSize: options.multipart.partSize }
          : {}),
        ...(options.multipart?.concurrency !== undefined
          ? { queueSize: options.multipart.concurrency }
          : {}),
        leavePartsOnError: false,
        ...(abortController ? { abortController } : {}),
      });

      const result = await upload.done();

      let url: string | undefined;
      try {
        url = await this.getUrl(normalized);
      } catch {
        url = undefined;
      }

      return {
        path: normalized,
        size: options.contentLength ?? bodyLength(body),
        etag: cleanEtag(result.ETag),
        versionId: result.VersionId,
        url,
        provider: 's3',
        native: result,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'upload', normalized);
    }
  }

  private async assertAbsent(
    normalized: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await this.requireClient().send(
        new this.sdk!.client.HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
        { abortSignal: signal },
      );
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404 || status === 400) return; // object absent
      this.fail(error, 'upload', normalized);
    }
    throw new StorageConflictError(
      `"${normalized}" already exists and overwrite is disabled`,
      { provider: 's3', path: normalized },
    );
  }

  async download(
    path: string,
    options: DownloadOptions<'s3'> = {},
  ): Promise<DownloadResult<'s3'>> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const input = {
        Bucket: this.config.bucket,
        Key: this.key(normalized),
        ...options.native,
      } as AwsS3.GetObjectCommandInput;
      if (options.versionId) input.VersionId = options.versionId;
      if (options.range) {
        input.Range =
          options.range.length !== undefined
            ? `bytes=${options.range.offset}-${options.range.offset + options.range.length - 1}`
            : `bytes=${options.range.offset}-`;
      }

      const response = await this.requireClient().send(
        new this.sdk!.client.GetObjectCommand(input),
        { abortSignal: options.signal },
      );

      const stream = toReadable(response.Body);
      const { Body: _body, ...rest } = response;

      return {
        stream,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        etag: cleanEtag(response.ETag),
        lastModified: response.LastModified,
        metadata: response.Metadata,
        versionId: response.VersionId,
        provider: 's3',
        native: rest as unknown as NonNullable<DownloadResult<'s3'>['native']>,
        buffer: () => streamToBuffer(stream),
        text: () => streamToBuffer(stream).then((b) => b.toString('utf8')),
        json: <V,>() => streamToBuffer(stream).then((b) => JSON.parse(b.toString('utf8')) as V),
      } as unknown as DownloadResult<'s3'>;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'download', normalized);
    }
  }

  async delete(path: string, options: DeleteOptions<'s3'> = {}): Promise<void> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const input = {
        Bucket: this.config.bucket,
        Key: this.key(normalized),
        ...options.native,
      } as AwsS3.DeleteObjectCommandInput;
      if (options.versionId) input.VersionId = options.versionId;
      await this.requireClient().send(new this.sdk!.client.DeleteObjectCommand(input), {
        abortSignal: options.signal,
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'delete', normalized);
    }
  }

  async deleteMany(
    paths: string[],
    options: DeleteManyOptions<'s3'> = {},
  ): Promise<DeleteManyResult> {
    await this.ready();
    const client = this.requireClient();
    const deleted: string[] = [];
    const failed: DeleteManyResult['failed'] = [];
    const internalKeys = paths.map((p) => ({
      key: this.key(normalizeKey(p)),
      original: normalizeKey(p),
    }));

    const chunks: (typeof internalKeys)[] = [];
    for (let i = 0; i < internalKeys.length; i += 1000) {
      chunks.push(internalKeys.slice(i, i + 1000));
    }

    for (const chunk of chunks) {
      try {
        const response = await client.send(
          new this.sdk!.client.DeleteObjectsCommand({
            Bucket: this.config.bucket,
            Delete: {
              Objects: chunk.map((entry) => ({ Key: entry.key })),
              Quiet: true,
            },
            ...(options.native ?? {}),
          }),
          { abortSignal: options.signal },
        );
        const errors = response.Errors ?? [];
        const errorByKey = new Map(errors.map((e) => [e.Key, e]));
        for (const entry of chunk) {
          const nativeError = errorByKey.get(entry.key);
          if (nativeError) {
            failed.push({
              path: entry.original,
              error: normalizeError(
                new Error(
                  `${nativeError.Code ?? 'Error'}: ${nativeError.Message ?? 'delete failed'}`,
                ),
                { provider: 's3', operation: 'deleteMany', path: entry.original },
              ),
            });
          } else {
            deleted.push(entry.original);
          }
        }
      } catch (error) {
        if (error instanceof StorageError) throw error;
        for (const entry of chunk) {
          failed.push({
            path: entry.original,
            error: normalizeError(error, {
              provider: 's3',
              operation: 'deleteMany',
              path: entry.original,
            }),
          });
        }
      }
    }
    return { deleted, failed };
  }

  async exists(path: string, options: ExistsOptions<'s3'> = {}): Promise<boolean> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      await this.requireClient().send(
        new this.sdk!.client.HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: this.key(normalized),
          ...options.native,
        }),
        { abortSignal: options.signal },
      );
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return false;
      if (error instanceof StorageError) throw error;
      this.fail(error, 'exists', normalized);
    }
  }

  async stat(path: string, options: StatOptions<'s3'> = {}): Promise<FileStat<'s3'>> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const input = {
        Bucket: this.config.bucket,
        Key: this.key(normalized),
        ...options.native,
      } as AwsS3.HeadObjectCommandInput;
      if (options.versionId) input.VersionId = options.versionId;
      const response = await this.requireClient().send(
        new this.sdk!.client.HeadObjectCommand(input),
        { abortSignal: options.signal },
      );
      return {
        path: normalized,
        size: response.ContentLength ?? 0,
        contentType: response.ContentType,
        etag: cleanEtag(response.ETag),
        lastModified: response.LastModified,
        metadata: response.Metadata,
        versionId: response.VersionId,
        provider: 's3',
        native: response,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'stat', normalized);
    }
  }

  async list(options: ListOptions<'s3'> = {}): Promise<ListResult<'s3'>> {
    try {
      await this.ready();
      const response = await this.requireClient().send(
        new this.sdk!.client.ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: joinKey(this.prefix, options.prefix ?? '') || undefined,
          MaxKeys: options.limit ?? 1000,
          Delimiter: options.recursive ? undefined : '/',
          ...(options.cursor ? { ContinuationToken: options.cursor } : {}),
          ...options.native,
        }),
        { abortSignal: options.signal },
      );

      const files: StorageFile[] = (response.Contents ?? []).map((object) => ({
        path: stripKey(this.prefix, object.Key ?? ''),
        size: object.Size,
        etag: cleanEtag(object.ETag),
        lastModified: object.LastModified,
      }));
      const directories = (response.CommonPrefixes ?? [])
        .map((cp) => stripKey(this.prefix, cp.Prefix ?? ''))
        .filter((p) => p.length > 0);

      return {
        files,
        directories,
        cursor: response.IsTruncated ? response.NextContinuationToken : undefined,
        hasMore: Boolean(response.IsTruncated),
        native: response,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'list');
    }
  }

  async copy(
    source: string,
    destination: string,
    options: CopyOptions<'s3'> = {},
  ): Promise<{ source: string; destination: string; etag?: string; lastModified?: Date }> {
    const src = normalizeKey(source);
    const dest = normalizeKey(destination);
    try {
      await this.ready();
      if (options.overwrite === false) {
        await this.assertAbsent(dest, this.key(dest), options.signal);
      }
      const input = {
        Bucket: this.config.bucket,
        Key: this.key(dest),
        CopySource: `/${this.config.bucket}/${encodeKeyPath(this.key(src))}`,
        ...options.native,
      } as AwsS3.CopyObjectCommandInput;

      const hasOverrides =
        options.contentType !== undefined ||
        options.metadata !== undefined ||
        options.cacheControl !== undefined ||
        options.contentDisposition !== undefined ||
        options.contentEncoding !== undefined;
      if (hasOverrides) {
        input.MetadataDirective = 'REPLACE';
        const contentType = this.contentTypeFor(dest, options.contentType);
        if (contentType !== undefined) input.ContentType = contentType;
        if (options.metadata !== undefined) input.Metadata = options.metadata;
        if (options.cacheControl !== undefined) input.CacheControl = options.cacheControl;
        if (options.contentDisposition !== undefined)
          input.ContentDisposition = options.contentDisposition;
        if (options.contentEncoding !== undefined)
          input.ContentEncoding = options.contentEncoding;
      }

      const response = await this.requireClient().send(
        new this.sdk!.client.CopyObjectCommand(input),
        { abortSignal: options.signal },
      );
      return {
        source: src,
        destination: dest,
        etag: cleanEtag(response.CopyObjectResult?.ETag),
        lastModified: response.CopyObjectResult?.LastModified,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'copy', src);
    }
  }

  async move(
    source: string,
    destination: string,
    options: MoveOptions<'s3'> = {},
  ): Promise<{ source: string; destination: string; etag?: string }> {
    const copied = await this.copy(source, destination, options as CopyOptions<'s3'>);
    await this.delete(source, { signal: options.signal });
    return {
      source: normalizeKey(source),
      destination: copied.destination,
      etag: copied.etag,
    };
  }

  async getUrl(path: string, _options: UrlOptions<'s3'> = {}): Promise<string> {
    const key = this.key(normalizeKey(path));
    if (this.config.publicUrlBase) {
      const base = this.config.publicUrlBase.replace(/\/+$/, '');
      return `${base}/${encodeKeyPath(key)}`;
    }
    const encoded = encodeKeyPath(key);
    if (this.config.endpoint) {
      const base = this.config.endpoint.replace(/\/+$/, '');
      return `${base}/${this.config.bucket}/${encoded}`;
    }
    const host = this.config.region
      ? `${this.config.bucket}.s3.${this.config.region}.amazonaws.com`
      : `${this.config.bucket}.s3.amazonaws.com`;
    return `https://${host}/${encoded}`;
  }

  async getSignedUrl(
    path: string,
    options: SignedUrlOptions<'s3'> = {},
  ): Promise<string> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const expiresIn = validateExpiry(options.expiresIn);
      const input = {
        Bucket: this.config.bucket,
        Key: this.key(normalized),
        ...options.native,
      } as AwsS3.GetObjectCommandInput & AwsS3.PutObjectCommandInput;
      const command =
        options.action === 'write'
          ? new this.sdk!.client.PutObjectCommand(input)
          : options.action === 'delete'
            ? new this.sdk!.client.DeleteObjectCommand(input)
            : new this.sdk!.client.GetObjectCommand(input);
      return await this.sdk!.presigner.getSignedUrl(this.requireClient(), command, {
        expiresIn,
      });
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
