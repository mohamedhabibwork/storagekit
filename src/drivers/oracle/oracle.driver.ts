import type * as OciCommon from 'oci-common';
import type * as OciObjectStorage from 'oci-objectstorage';

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
import {
  bodyLength,
  chunkStream,
  mapWithConcurrency,
  toReadable,
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
import type { OracleStorageConfig } from './oracle.types';
import type { StorageDriver } from '../driver';

type CommonSdk = typeof OciCommon;
type ObjectStorageSdk = typeof OciObjectStorage;

let commonPromise: Promise<CommonSdk> | undefined;
let objectStoragePromise: Promise<ObjectStorageSdk> | undefined;

async function loadOciCommon(): Promise<CommonSdk> {
  if (!commonPromise) {
    commonPromise = (async () => {
      try {
        const mod = await import('oci-common');
        return mod as unknown as CommonSdk;
      } catch (error) {
        commonPromise = undefined;
        throw new StorageInvalidConfigError(
          'The Oracle driver requires the OCI SDK. Install it with:\n' +
            'npm install oci-common oci-objectstorage',
          { cause: error },
        );
      }
    })();
  }
  return commonPromise;
}

async function loadOciObjectStorage(): Promise<ObjectStorageSdk> {
  if (!objectStoragePromise) {
    objectStoragePromise = (async () => {
      try {
        const mod = await import('oci-objectstorage');
        return mod as unknown as ObjectStorageSdk;
      } catch (error) {
        objectStoragePromise = undefined;
        throw new StorageInvalidConfigError(
          'The Oracle driver requires the OCI SDK. Install it with:\n' +
            'npm install oci-common oci-objectstorage',
          { cause: error },
        );
      }
    })();
  }
  return objectStoragePromise;
}

export interface OracleDriverRuntimeOptions {
  detectContentType?: boolean;
}

export const OCI_MAX_PART_SIZE = 128 * 1024 * 1024; // OCI part size ceiling

export class OracleDriver implements StorageDriver<'oracle'> {
  readonly type = 'oracle' as const;

  private readonly config: OracleStorageConfig;
  private readonly runtime: OracleDriverRuntimeOptions;
  private readonly prefix?: string;
  private client: OciObjectStorage.ObjectStorageClient | undefined;

  constructor(config: OracleStorageConfig, runtime: OracleDriverRuntimeOptions = {}) {
    this.config = config;
    this.runtime = runtime;
    this.prefix = config.prefix?.replace(/\/+$/, '') || undefined;
    if (this.prefix) normalizeKey(this.prefix);
  }

  async ready(): Promise<this> {
    if (this.client) return this;
    const sdk = await loadOciObjectStorage();
    if (this.config.client) {
      this.client = this.config.client;
      return this;
    }
    const authProvider = this.config.authProvider ?? (await this.resolveAuthProvider());
    this.client = new sdk.ObjectStorageClient({
      authenticationDetailsProvider: authProvider,
      ...this.config.clientOptions,
    } as unknown as ConstructorParameters<typeof sdk.ObjectStorageClient>[0]);
    return this;
  }

  private async resolveAuthProvider(): Promise<OciCommon.AuthenticationDetailsProvider> {
    const auth = this.config.auth ?? { type: 'config-file' as const };
    if (auth.type === 'provider') return auth.provider;
    const common = await loadOciCommon();
    switch (auth.type) {
      case 'config-file':
        return new common.ConfigFileAuthenticationDetailsProvider(
          auth.configFilePath,
          auth.profile,
        );
      case 'instance-principals':
        // Build() is async — instance principals require a metadata call.
        return await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
      case 'resource-principals': {
        const Provider = common.ResourcePrincipalAuthenticationDetailsProvider as unknown as {
          builder(): { build(): OciCommon.AuthenticationDetailsProvider };
        };
        return Provider.builder().build();
      }
    }
  }

  private requireClient(): OciObjectStorage.ObjectStorageClient {
    if (!this.client) {
      throw new StorageInvalidConfigError(
        'Oracle driver is not initialized; await driver.ready() or use createStorage()',
      );
    }
    return this.client;
  }

  native(): OciObjectStorage.ObjectStorageClient {
    return this.requireClient();
  }

  nativeRequest<R>(
    fn: (client: OciObjectStorage.ObjectStorageClient) => Promise<R>,
  ): Promise<R> {
    return fn(this.requireClient());
  }

  capabilities(): StorageCapabilities {
    return {
      signedUrls: false,
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
    throw normalizeError(error, { provider: 'oracle', operation, path });
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
    options: UploadOptions<'oracle'> = {},
  ): Promise<UploadResult<'oracle'>> {
    const normalized = normalizeKey(path);
    const key = this.key(normalized);
    try {
      await this.ready();
      const client = this.requireClient();

      if (options.overwrite === false) {
        await this.assertAbsent(normalized, key, options.signal);
      }

      const native = options.native ?? {};
      const metadata =
        options.metadata !== undefined || native.opcMeta !== undefined
          ? { ...options.metadata, ...native.opcMeta }
          : undefined;
      const commonRequest: Record<string, unknown> = {
        namespaceName: this.config.namespaceName,
        bucketName: this.config.bucketName,
        objectName: key,
        contentType: this.contentTypeFor(normalized, options.contentType),
        cacheControl: options.cacheControl,
        contentDisposition: options.contentDisposition,
        contentEncoding: options.contentEncoding,
        ...(metadata !== undefined ? { opcMeta: metadata } : {}),
        ...native,
      };

      const isInMemory =
        Buffer.isBuffer(body) ||
        body instanceof Uint8Array ||
        typeof body === 'string' ||
        body instanceof ArrayBuffer ||
        (typeof Blob !== 'undefined' && body instanceof Blob);

      if (!options.multipart?.enabled && isInMemory) {
        const buffer = await toBuffer(body);
        const response = await client.putObject({
          ...commonRequest,
          putObjectBody: buffer,
          contentLength: options.contentLength ?? buffer.length,
        } as OciObjectStorage.requests.PutObjectRequest);
        let url: string | undefined;
        try {
          url = await this.getUrl(normalized);
        } catch {
          url = undefined;
        }
        return {
          path: normalized,
          size: buffer.length,
          etag: response.eTag,
          url,
          provider: 'oracle',
          native: response,
        };
      }

      const result = await this.multipartUpload(key, body, options, commonRequest);
      let url: string | undefined;
      try {
        url = await this.getUrl(normalized);
      } catch {
        url = undefined;
      }
      return {
        path: normalized,
        size: options.contentLength ?? bodyLength(body),
        etag: result.etag,
        url,
        provider: 'oracle',
        native: result.response,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'upload', normalized);
    }
  }

  /** Drive OCI's native multipart upload API from any upload body. */
  private async multipartUpload(
    key: string,
    body: UploadBody,
    options: UploadOptions<'oracle'>,
    commonRequest: Record<string, unknown>,
  ): Promise<{ etag?: string; response: OciObjectStorage.responses.CommitMultipartUploadResponse }> {
    const client = this.requireClient();
    const created = await client.createMultipartUpload({
      namespaceName: this.config.namespaceName,
      bucketName: this.config.bucketName,
      createMultipartUploadDetails: {
        object: key,
        contentType: commonRequest.contentType as string | undefined,
        cacheControl: commonRequest.cacheControl as string | undefined,
        contentDisposition: commonRequest.contentDisposition as string | undefined,
        contentEncoding: commonRequest.contentEncoding as string | undefined,
        ...(commonRequest.opcMeta !== undefined
          ? { opcMeta: commonRequest.opcMeta }
          : {}),
        ...(commonRequest.storageTier !== undefined
          ? { storageTier: commonRequest.storageTier }
          : {}),
      },
    } as OciObjectStorage.requests.CreateMultipartUploadRequest);
    const uploadId = created.multipartUpload?.uploadId;

    if (!uploadId) {
      throw new StorageError('OCI did not return a multipart uploadId', {
        provider: 'oracle',
        operation: 'upload',
        path: key,
      });
    }

    const partSize = Math.min(
      Math.max(options.multipart?.partSize ?? 64 * 1024 * 1024, 1024 * 1024),
      OCI_MAX_PART_SIZE,
    );
    const concurrency = Math.max(
      1,
      Math.min(options.multipart?.concurrency ?? 4, 16),
    );

    try {
      const stream = toReadable(body);
      const parts: Buffer[] = [];
      for await (const chunk of chunkStream(stream, partSize)) {
        parts.push(chunk);
      }

      const uploaded = await mapWithConcurrency(
        parts,
        concurrency,
        async (part, index) => {
          const response = await client.uploadPart({
            namespaceName: this.config.namespaceName,
            bucketName: this.config.bucketName,
            objectName: key,
            uploadId,
            uploadPartNum: index + 1,
            contentLength: part.length,
            uploadPartBody: part,
          });
          return { partNum: index + 1, etag: response.eTag ?? '' };
        },
      );

      const committed = await client.commitMultipartUpload({
        namespaceName: this.config.namespaceName,
        bucketName: this.config.bucketName,
        objectName: key,
        uploadId,
        commitMultipartUploadDetails: {
          partsToCommit: uploaded,
        },
      });
      return { etag: committed.eTag, response: committed };
    } catch (error) {
      await client
        .abortMultipartUpload({
          namespaceName: this.config.namespaceName,
          bucketName: this.config.bucketName,
          objectName: key,
          uploadId,
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private async assertAbsent(
    normalized: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<void> {
    void signal;
    try {
      await this.requireClient().headObject({
        namespaceName: this.config.namespaceName,
        bucketName: this.config.bucketName,
        objectName: key,
      });
    } catch (error) {
      if (isMissing(error)) return;
      this.fail(error, 'upload', normalized);
    }
    throw new StorageConflictError(
      `"${normalized}" already exists and overwrite is disabled`,
      { provider: 'oracle', path: normalized },
    );
  }

  async download(
    path: string,
    options: DownloadOptions<'oracle'> = {},
  ): Promise<DownloadResult<'oracle'>> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const client = this.requireClient();
      const request: OciObjectStorage.requests.GetObjectRequest = {
        namespaceName: this.config.namespaceName,
        bucketName: this.config.bucketName,
        objectName: this.key(normalized),
        ...options.native,
      };
      if (options.versionId) request.versionId = options.versionId;
      if (options.range) {
        const common = await loadOciCommon();
        request.range = new common.Range(
          options.range.offset,
          options.range.length !== undefined
            ? options.range.offset + options.range.length - 1
            : null,
          null,
        );
      }

      const response = await client.getObject(request);
      const stream = toReadable(response.value);
      const { value: _value, ...rest } = response;

      return {
        stream,
        contentType: response.contentType,
        contentLength: response.contentLength,
        etag: response.eTag,
        lastModified: response.lastModified,
        metadata: response.opcMeta,
        versionId: response.versionId,
        range: options.range,
        provider: 'oracle',
        native: rest,
        buffer: () => streamToBuffer(stream),
        text: () => streamToBuffer(stream).then((b) => b.toString('utf8')),
        json: <V,>() => streamToBuffer(stream).then((b) => JSON.parse(b.toString('utf8')) as V),
      } as unknown as DownloadResult<'oracle'>;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'download', normalized);
    }
  }

  async delete(path: string, options: DeleteOptions<'oracle'> = {}): Promise<void> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const request: OciObjectStorage.requests.DeleteObjectRequest = {
        namespaceName: this.config.namespaceName,
        bucketName: this.config.bucketName,
        objectName: this.key(normalized),
        ...options.native,
      };
      if (options.versionId) request.versionId = options.versionId;
      await this.requireClient().deleteObject(request);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'delete', normalized);
    }
  }

  async deleteMany(
    paths: string[],
    options: DeleteManyOptions<'oracle'> = {},
  ): Promise<DeleteManyResult> {
    await this.ready();
    const settled = await Promise.allSettled(
      paths.map((p) => this.delete(p, options as DeleteOptions<'oracle'>)),
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
            provider: 'oracle',
            operation: 'deleteMany',
            path,
          }),
        });
    });
    return { deleted, failed };
  }

  async exists(path: string, options: ExistsOptions<'oracle'> = {}): Promise<boolean> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      await this.requireClient().headObject({
        namespaceName: this.config.namespaceName,
        bucketName: this.config.bucketName,
        objectName: this.key(normalized),
        ...options.native,
      });
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      if (error instanceof StorageError) throw error;
      this.fail(error, 'exists', normalized);
    }
  }

  async stat(
    path: string,
    options: StatOptions<'oracle'> = {},
  ): Promise<FileStat<'oracle'>> {
    const normalized = normalizeKey(path);
    try {
      await this.ready();
      const request: OciObjectStorage.requests.HeadObjectRequest = {
        namespaceName: this.config.namespaceName,
        bucketName: this.config.bucketName,
        objectName: this.key(normalized),
        ...options.native,
      };
      if (options.versionId) request.versionId = options.versionId;
      const response = await this.requireClient().headObject(request);
      return {
        path: normalized,
        size: response.contentLength ?? 0,
        contentType: response.contentType,
        etag: response.eTag,
        lastModified: response.lastModified,
        metadata: response.opcMeta,
        versionId: response.versionId,
        provider: 'oracle',
        native: response,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'stat', normalized);
    }
  }

  async list(options: ListOptions<'oracle'> = {}): Promise<ListResult<'oracle'>> {
    try {
      await this.ready();
      const client = this.requireClient();
      const native = options.native ?? {};
      const request: OciObjectStorage.requests.ListObjectsRequest = {
        namespaceName: this.config.namespaceName,
        bucketName: this.config.bucketName,
        prefix: joinKey(this.prefix, options.prefix ?? '') || undefined,
        limit: Math.max(1, options.limit ?? 1000),
        ...(options.recursive ? {} : { delimiter: '/' }),
        ...(options.cursor ? { start: options.cursor } : {}),
        fields: 'name,size,etag,timeModified',
        ...native,
      };
      const response = await client.listObjects(request);
      const listing = response.listObjects;

      const files: StorageFile[] = (listing.objects ?? [])
        .filter((object) => object.name !== undefined)
        .map((object) => ({
          path: stripKey(this.prefix, object.name ?? ''),
          size: object.size,
          etag: object.etag,
          lastModified: object.timeModified,
        }));
      const directories = (listing.prefixes ?? [])
        .map((p) => stripKey(this.prefix, p))
        .filter((p) => p.length > 0);

      return {
        files,
        directories,
        cursor: listing.nextStartWith,
        hasMore: Boolean(listing.nextStartWith),
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
    options: CopyOptions<'oracle'> = {},
  ): Promise<{ source: string; destination: string; etag?: string; lastModified?: Date }> {
    const src = normalizeKey(source);
    const dest = normalizeKey(destination);
    try {
      await this.ready();
      if (options.overwrite === false) {
        await this.assertAbsent(dest, this.key(dest), options.signal);
      }
      const native = options.native ?? {};
      const destinationRegion = native.destinationRegion ?? this.config.region;
      if (!destinationRegion) {
        throw new StorageInvalidConfigError(
          'Oracle copyObject requires `region` in the config (or native.destinationRegion)',
        );
      }
      const response = await this.requireClient().copyObject({
        namespaceName: this.config.namespaceName,
        bucketName: this.config.bucketName,
        copyObjectDetails: {
          sourceObjectName: this.key(src),
          destinationBucket: this.config.bucketName,
          destinationObjectName: this.key(dest),
          destinationRegion,
          destinationNamespace: native.destinationNamespace ?? this.config.namespaceName,
          ...(options.contentType !== undefined || options.metadata !== undefined
            ? {
                destinationMetadata: {
                  ...(options.contentType !== undefined
                    ? { contentType: options.contentType }
                    : {}),
                  ...(options.metadata !== undefined
                    ? { userMetadata: options.metadata }
                    : {}),
                },
              }
            : {}),
          ...native,
        },
      });

      // OCI copy is asynchronous server-side work; the response carries a
      // work request id rather than an ETag.
      return {
        source: src,
        destination: dest,
      };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      this.fail(error, 'copy', src);
    }
  }

  async move(
    source: string,
    destination: string,
    options: MoveOptions<'oracle'> = {},
  ): Promise<{ source: string; destination: string; etag?: string }> {
    const copied = await this.copy(source, destination, options as CopyOptions<'oracle'>);
    await this.delete(source, { signal: options.signal });
    return {
      source: normalizeKey(source),
      destination: copied.destination,
      etag: copied.etag,
    };
  }

  async getUrl(path: string, _options: UrlOptions<'oracle'> = {}): Promise<string> {
    const key = this.key(normalizeKey(path));
    if (this.config.publicUrlBase) {
      const base = this.config.publicUrlBase.replace(/\/+$/, '');
      return `${base}/${encodeKeyPath(key)}`;
    }
    if (!this.config.region) {
      throw new StorageUnsupportedOperationError(
        'getUrl() requires `region` (or `publicUrlBase`) in the Oracle storage config',
      );
    }
    return `https://objectstorage.${this.config.region}.oraclecloud.com/n/${this.config.namespaceName}/b/${this.config.bucketName}/o/${encodeKeyPath(key)}`;
  }

  async getSignedUrl(
    path: string,
    _options?: SignedUrlOptions<'oracle'>,
  ): Promise<string> {
    void path;
    throw new StorageUnsupportedOperationError(
      'Oracle Object Storage has no presigned URLs. Use pre-authenticated requests via nativeRequest() — see ObjectStorageClient.createPreauthenticatedRequest. Their lifecycle and scope differ from presigned URLs.',
    );
  }
}

async function toBuffer(body: UploadBody): Promise<Buffer> {
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  return streamToBuffer(body as never);
}

function isMissing(error: unknown): boolean {
  const like = error as { statusCode?: number; code?: string; name?: string };
  if (like.statusCode === 404) return true;
  const code = like.code ?? like.name;
  return code === 'NotExists' || code === 'NotFound' || code === 'NoSuchObject';
}
