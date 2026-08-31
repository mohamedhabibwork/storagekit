import { Readable } from 'node:stream';

import type * as Azure from '@azure/storage-blob';

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
import { streamToBuffer } from '../../core/streams';
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
import type { AzureStorageConfig } from './azure.types';
import type { StorageDriver } from '../driver';

type AzureSdk = typeof Azure;

let sdkPromise: Promise<AzureSdk> | undefined;

async function loadAzureSdk(): Promise<AzureSdk> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      try {
        const mod = await import('@azure/storage-blob');
        return mod as unknown as AzureSdk;
      } catch (error) {
        sdkPromise = undefined;
        throw new StorageInvalidConfigError(
          'The Azure driver requires @azure/storage-blob. Install it with:\n' +
            'npm install @azure/storage-blob',
          { cause: error },
        );
      }
    })();
  }
  return sdkPromise;
}

export interface AzureDriverRuntimeOptions {
  detectContentType?: boolean;
}

/** Minimal shape of a connection string we need for SAS generation. */
function parseConnectionString(
  connectionString: string,
): { accountName: string; accountKey: string; endpointSuffix?: string; blobEndpoint?: string } | undefined {
  const parts: Record<string, string> = {};
  for (const pair of connectionString.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    parts[pair.slice(0, eq).toLowerCase()] = pair.slice(eq + 1);
  }
  if (!parts.accountname || !parts.accountkey) return undefined;
  return {
    accountName: parts.accountname,
    accountKey: parts.accountkey,
    endpointSuffix: parts.endpointsuffix,
    blobEndpoint: parts.blobendpoint,
  };
}

export const MAX_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;

export class AzureDriver implements StorageDriver<'azure'> {
  readonly type = 'azure' as const;

  private readonly config: AzureStorageConfig;
  private readonly runtime: AzureDriverRuntimeOptions;
  private readonly prefix?: string;
  private containerClient: Azure.ContainerClient | undefined;
  private sdk: AzureSdk | undefined;
  private sharedKeyCredential: Azure.StorageSharedKeyCredential | undefined;

  constructor(config: AzureStorageConfig, runtime: AzureDriverRuntimeOptions = {}) {
    this.config = config;
    this.runtime = runtime;
    this.prefix = config.prefix?.replace(/\/+$/, '') || undefined;
    if (this.prefix) normalizeKey(this.prefix);
  }

  async ready(): Promise<this> {
    if (this.containerClient) return this;
    const sdk = await loadAzureSdk();
    this.sdk = sdk;

    if (this.config.containerClient) {
      this.containerClient = this.config.containerClient;
      return this;
    }

    let serviceClient: Azure.BlobServiceClient | undefined = this.config.serviceClient;
    if (!serviceClient) {
      if (this.config.connectionString) {
        const parsed = parseConnectionString(this.config.connectionString);
        if (!parsed) {
          throw new StorageInvalidConfigError(
            'The provided Azure connection string does not contain AccountName/AccountKey',
          );
        }
        this.sharedKeyCredential = new sdk.StorageSharedKeyCredential(
          parsed.accountName,
          parsed.accountKey,
        );
        const blobEndpoint =
          parsed.blobEndpoint ??
          `https://${parsed.accountName}.blob.${parsed.endpointSuffix ?? 'core.windows.net'}`;
        serviceClient = new sdk.BlobServiceClient(blobEndpoint, this.sharedKeyCredential);
      } else if (this.config.accountUrl) {
        serviceClient = new sdk.BlobServiceClient(this.config.accountUrl, this.config.credential);
      } else {
        throw new StorageInvalidConfigError(
          'Azure storage config requires one of: connectionString, accountUrl (+ credential), serviceClient, or containerClient',
        );
      }
    }

    this.containerClient = serviceClient.getContainerClient(this.config.container);
    return this;
  }

  private requireClient(): Azure.ContainerClient {
    if (!this.containerClient) {
      throw new StorageInvalidConfigError(
        'Azure driver is not initialized; await driver.ready() or use createStorage()',
      );
    }
    return this.containerClient;
  }

  native(): Azure.ContainerClient {
    return this.requireClient();
  }

  nativeRequest<R>(fn: (client: Azure.ContainerClient) => Promise<R>): Promise<R> {
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
      bulkDelete: false,
    };
  }

  private key(key: string): string {
    return joinKey(this.prefix, normalizeKey(key));
  }

  private fail(error: unknown, operation: string, path?: string): never {
    throw normalizeError(error, { provider: 'azure', operation, path });
  }

  private blobHTTPHeadersFrom(options: {
    contentType?: string;
    cacheControl?: string;
    contentDisposition?: string;
    contentEncoding?: string;
  }): Azure.BlobHTTPHeaders | undefined {
    const headers: Azure.BlobHTTPHeaders = {};
    if (options.contentType !== undefined) headers.blobContentType = options.contentType;
    if (options.cacheControl !== undefined) headers.blobCacheControl = options.cacheControl;
    if (options.contentDisposition !== undefined)
      headers.blobContentDisposition = options.contentDisposition;
    if (options.contentEncoding !== undefined)
      headers.blobContentEncoding = options.contentEncoding;
    return Object.keys(headers).length > 0 ? headers : undefined;
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
    options: UploadOptions<'azure'> = {},
  ): Promise<UploadResult<'azure'>> {
    const normalized = normalizeKey(path);
    const key = this.key(normalized);
    try {
      await this.ready();
      const client = this.requireClient();
      const blockBlob = client.getBlockBlobClient(key);

      if (options.overwrite === false) {
        await this.assertAbsent(normalized, blockBlob, options.signal);
      }

      const headers = this.blobHTTPHeadersFrom({
        contentType: this.contentTypeFor(normalized, options.contentType),
        cacheControl: options.cacheControl,
        contentDisposition: options.contentDisposition,
        contentEncoding: options.contentEncoding,
      });
      const blobHTTPHeaders: Azure.BlobHTTPHeaders | undefined = headers
        ? { ...headers, ...options.native?.blobHTTPHeaders }
        : options.native?.blobHTTPHeaders;

      const common: Azure.BlockBlobUploadOptions = {
        ...(blobHTTPHeaders ? { blobHTTPHeaders } : {}),
        ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
        ...(options.native?.tier !== undefined ? { tier: options.native.tier } : {}),
        ...(options.native?.conditions !== undefined
          ? { conditions: options.native.conditions }
          : {}),
        ...(options.native?.tags !== undefined ? { tags: options.native.tags } : {}),
        abortSignal: options.signal,
      };

      let etag: string | undefined;
      let versionId: string | undefined;

      if (body instanceof Readable) {
        const bufferSize = options.multipart?.partSize ?? 8 * 1024 * 1024;
        const maxConcurrency = options.multipart?.concurrency ?? 5;
        const response = await blockBlob.uploadStream(body, bufferSize, maxConcurrency, {
          ...common,
          abortSignal: options.signal,
        });
        etag = response.etag;
        versionId = response.versionId;
      } else {
        let data: Buffer | Uint8Array | Blob | ArrayBuffer;
        if (typeof body === 'string') data = Buffer.from(body, 'utf8');
        else if (body instanceof ArrayBuffer) data = body;
        else if (Buffer.isBuffer(body) || body instanceof Uint8Array) data = body;
        else if (typeof Blob !== 'undefined' && body instanceof Blob) data = body;
        else {
          throw new StorageUnsupportedOperationError(
            `Unsupported upload body for the Azure driver: ${typeof body}`,
          );
        }
        const response = await blockBlob.uploadData(data, common);
        etag = response.etag;
        versionId = response.versionId;
      }

      const size =
        options.contentLength ??
        (typeof body === 'string'
          ? Buffer.byteLength(body, 'utf8')
          : Buffer.isBuffer(body)
            ? body.length
            : body instanceof Uint8Array
              ? body.byteLength
              : body instanceof ArrayBuffer
                ? body.byteLength
                : undefined);

      return {
        path: normalized,
        size,
        etag: stripQuotes(etag),
        versionId,
        url: await this.getUrl(normalized),
        provider: 'azure',
        native: { etag, versionId },
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'upload', normalized);
    }
  }

  private async assertAbsent(
    normalized: string,
    blockBlob: Azure.BlockBlobClient,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await blockBlob.getProperties({ abortSignal: signal });
    } catch (error) {
      if (isMissing(error)) return;
      this.fail(error, 'upload', normalized);
    }
    throw new StorageConflictError(
      `"${normalized}" already exists and overwrite is disabled`,
      { provider: 'azure', path: normalized },
    );
  }

  async download(
    path: string,
    options: DownloadOptions<'azure'> = {},
  ): Promise<DownloadResult<'azure'>> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const client = this.requireClient();
      const blobClient = client.getBlobClient(this.key(normalized));
      const target = options.versionId
        ? blobClient.withVersion(options.versionId)
        : blobClient;

      const downloadOptions: Azure.BlobDownloadOptions = {
        ...options.native,
        ...(options.native?.conditions !== undefined
          ? { conditions: options.native.conditions }
          : {}),
        abortSignal: options.signal,
      };

      const response = await target.download(
        options.range?.offset,
        options.range?.length,
        downloadOptions,
      );

      const stream = response.readableStreamBody as unknown as Readable;
      const {
        readableStreamBody: _stream,
        blobBody: _blob,
        ...rest
      } = response;

      return {
        stream,
        contentType: response.contentType,
        contentLength: response.contentLength,
        etag: stripQuotes(response.etag),
        lastModified: response.lastModified,
        metadata: response.metadata,
        versionId: response.versionId,
        provider: 'azure',
        native: rest,
        buffer: () => streamToBuffer(stream),
        text: () => streamToBuffer(stream).then((b) => b.toString('utf8')),
        json: <V,>() => streamToBuffer(stream).then((b) => JSON.parse(b.toString('utf8')) as V),
      } as unknown as DownloadResult<'azure'>;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'download', normalized);
    }
  }

  async delete(path: string, options: DeleteOptions<'azure'> = {}): Promise<void> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const client = this.requireClient();
      const deleteOptions: Azure.BlobDeleteOptions = {
        ...options.native,
        abortSignal: options.signal,
      };
      if (options.versionId) {
        await client
          .getBlobClient(this.key(normalized))
          .withVersion(options.versionId)
          .delete(deleteOptions);
      } else {
        await client.getBlockBlobClient(this.key(normalized)).delete(deleteOptions);
      }
    } catch (error) {
      // Azure delete on a missing blob returns 404; treat it as a no-op
      // like every other driver.
      if (isMissing(error)) return;
      if (error instanceof StorageError) throw error;
      this.fail(error, 'delete', normalized);
    }
  }

  async deleteMany(
    paths: string[],
    options: DeleteManyOptions<'azure'> = {},
  ): Promise<DeleteManyResult> {
    await this.ready();
    const settled = await Promise.allSettled(
      paths.map((p) => this.delete(p, options as DeleteOptions<'azure'>)),
    );
    const deleted: string[] = [];
    const failed: DeleteManyResult['failed'] = [];
    settled.forEach((result, index) => {
      const path = paths[index];
      if (result.status === 'fulfilled') deleted.push(path);
      else
        failed.push({
          path,
          error: normalizeError(result.reason, {
            provider: 'azure',
            operation: 'deleteMany',
            path,
          }),
        });
    });
    return { deleted, failed };
  }

  async exists(path: string, options: ExistsOptions<'azure'> = {}): Promise<boolean> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const client = this.requireClient();
      const blockBlob = client.getBlockBlobClient(this.key(normalized));
      await blockBlob.getProperties({
        abortSignal: options.signal,
        ...options.native,
      });
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      if (error instanceof StorageError) throw error;
      this.fail(error, 'exists', normalized);
    }
  }

  async stat(path: string, options: StatOptions<'azure'> = {}): Promise<FileStat<'azure'>> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const client = this.requireClient();
      const blobClient = client.getBlobClient(this.key(normalized));
      const target = options.versionId
        ? blobClient.withVersion(options.versionId)
        : blobClient;
      const response = await target.getProperties({
        ...options.native,
        ...(options.native?.conditions !== undefined
          ? { conditions: options.native.conditions }
          : {}),
        abortSignal: options.signal,
      });
      return {
        path: normalized,
        size: response.contentLength ?? 0,
        contentType: response.contentType,
        etag: stripQuotes(response.etag),
        lastModified: response.lastModified,
        metadata: response.metadata,
        versionId: response.versionId,
        provider: 'azure',
        native: response,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'stat', normalized);
    }
  }

  async list(options: ListOptions<'azure'> = {}): Promise<ListResult<'azure'>> {
    try {
      await this.ready();
      const client = this.requireClient();
      const prefix = joinKey(this.prefix, options.prefix ?? '');
      const maxPageSize = Math.max(1, options.limit ?? 1000);

      const iterator =
        options.recursive === true
          ? client.listBlobsFlat({ prefix, ...options.native }).byPage({
              continuationToken: options.cursor,
              maxPageSize,
            })
          : client.listBlobsByHierarchy('/', { prefix, ...options.native }).byPage({
              continuationToken: options.cursor,
              maxPageSize,
            });

      const page =
        (await iterator.next()).value as Azure.ContainerListBlobHierarchySegmentResponse;

      const files: StorageFile[] = (page.segment?.blobItems ?? []).map((blob) => ({
        path: stripKey(this.prefix, blob.name),
        size: blob.properties?.contentLength,
        etag: stripQuotes(blob.properties?.etag),
        lastModified: blob.properties?.lastModified,
        metadata: (blob.properties as { metadata?: Record<string, string> }).metadata,
      }));
      const directories = (page.segment?.blobPrefixes ?? [])
        .map((p) => stripKey(this.prefix, p.name))
        .filter((p) => p.length > 0);

      const continuation = page.continuationToken;
      const hasMore = Boolean(continuation);
      return {
        files,
        directories,
        cursor: hasMore ? continuation : undefined,
        hasMore,
        native: page,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'list');
    }
  }

  async copy(
    source: string,
    destination: string,
    options: CopyOptions<'azure'> = {},
  ): Promise<{ source: string; destination: string; etag?: string; lastModified?: Date }> {
    const src = normalizeKey(source);
    const dest = normalizeKey(destination);
    try {
      await this.ready();
      const client = this.requireClient();

      if (options.overwrite === false) {
        const destBlob = client.getBlockBlobClient(this.key(dest));
        await this.assertAbsent(dest, destBlob, options.signal);
      }

      const sourceUrl = client.getBlobClient(this.key(src)).url;
      const destBlob = client.getBlockBlobClient(this.key(dest));

      const headers = this.blobHTTPHeadersFrom({
        contentType: this.contentTypeFor(dest, options.contentType),
        cacheControl: options.cacheControl,
        contentDisposition: options.contentDisposition,
        contentEncoding: options.contentEncoding,
      });

      const poller = await destBlob.beginCopyFromURL(sourceUrl, {
        ...options.native,
        ...(headers ? { blobHTTPHeaders: headers } : {}),
        ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
        abortSignal: options.signal,
      });

      let response = poller.getResult();
      // Same-account copies usually complete synchronously; poll briefly.
      let attempts = 0;
      while (response?.copyStatus !== 'success' && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempts + 1)));
        response = poller.getResult();
        attempts += 1;
        if (poller.isDone()) break;
      }
      if (response?.copyStatus !== 'success') {
        throw new StorageUnsupportedOperationError(
          `Azure copy from "${source}" to "${destination}" did not complete synchronously; keep the poller via nativeRequest() to await it`,
        );
      }

      return {
        source: src,
        destination: dest,
        etag: stripQuotes(response.etag),
        lastModified: response.lastModified,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'copy', src);
    }
  }

  async move(
    source: string,
    destination: string,
    options: MoveOptions<'azure'> = {},
  ): Promise<{ source: string; destination: string; etag?: string }> {
    const copied = await this.copy(source, destination, options as CopyOptions<'azure'>);
    await this.delete(source, { signal: options.signal });
    return {
      source: normalizeKey(source),
      destination: copied.destination,
      etag: copied.etag,
    };
  }

  async getUrl(path: string, _options: UrlOptions<'azure'> = {}): Promise<string> {
    const key = this.key(normalizeKey(path));
    if (this.config.publicUrlBase) {
      const base = this.config.publicUrlBase.replace(/\/+$/, '');
      return `${base}/${encodeKeyPath(key)}`;
    }
    return `${this.requireClient().url.replace(/\/+$/, '')}/${encodeKeyPath(key)}`;
  }

  async getSignedUrl(
    path: string,
    options: SignedUrlOptions<'azure'> = {},
  ): Promise<string> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const sdk = this.sdk!;
      const credential =
        this.config.credential && 'accountName' in (this.config.credential as object)
          ? (this.config.credential as Azure.StorageSharedKeyCredential)
          : this.sharedKeyCredential;
      if (!credential) {
        throw new StorageUnsupportedOperationError(
          'Azure signed URLs require shared-key credentials (connection string or StorageSharedKeyCredential). ' +
            'TokenCredential-based signing needs user delegation keys — use nativeRequest() with getUserDelegationKey.',
        );
      }

      const native = options.native ?? {};
      const expiresOn =
        native.expiresOn !== undefined
          ? undefined
          : new Date(Date.now() + validateExpiry(options.expiresIn) * 1000);

      const permissionsValue =
        options.action === 'write' ? 'cw' : options.action === 'delete' ? 'd' : 'r';

      const sas = sdk.generateBlobSASQueryParameters(
        {
          containerName: this.config.container,
          blobName: this.key(normalized),
          permissions: sdk.BlobSASPermissions.parse(permissionsValue),
          expiresOn,
          ...native,
        },
        credential,
      );

      const blobUrl = this.requireClient().getBlobClient(this.key(normalized)).url;
      return `${blobUrl}?${sas.toString()}`;
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

function stripQuotes(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/^"(.*)"$/, '$1');
}

function isMissing(error: unknown): boolean {
  const like = error as {
    statusCode?: number;
    code?: string;
    name?: string;
    details?: { errorCode?: string; statusCode?: number };
  };
  if (like.statusCode === 404 || like.details?.statusCode === 404) return true;
  const code = like.code ?? like.name ?? like.details?.errorCode;
  return (
    code === 'BlobNotFound' ||
    code === 'ContainerNotFound' ||
    code === 'TheSpecifiedBlobDoesNotExist'
  );
}
