import { S3Driver } from '../s3/s3.driver';
import type { S3DriverRuntimeOptions } from '../s3/s3.driver';
import type { S3StorageConfig } from '../s3/s3.types';
import type {
  CopyOptions,
  CopyResult,
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
  MoveResult,
  SignedUrlOptions,
  StatOptions,
  StorageCapabilities,
  UploadBody,
  UploadOptions,
  UploadResult,
  UrlOptions,
} from '../../core/types';
import type { MapValueFor, NativeClientMap } from '../../core/maps';
import type { StorageDriver } from '../driver';
import type { RustfsStorageConfig } from './rustfs.types';

/**
 * RustFS driver. RustFS is S3-compatible and uses the AWS SDK v3 wire
 * protocol, so this is a thin wrapper around {@link S3Driver} that
 *
 * - reports `type = 'rustfs'` (the user-facing identifier),
 * - applies RustFS' server defaults (`region: 'us-east-1'`,
 *   `forcePathStyle: true`) when the caller did not override them, and
 * - re-labels the `provider` field on returned objects so the public
 *   storage is `Storage<'rustfs'>` end-to-end.
 *
 * The native SDK client is the same `S3Client` returned by `native()`
 * — RustFS has no separate JS SDK. See `docs/rustfs.md` for the upstream
 * protocol reference.
 */
export class RustfsDriver implements StorageDriver<'rustfs'> {
  readonly type = 'rustfs' as const;

  private readonly inner: S3Driver;

  constructor(config: RustfsStorageConfig, runtime: S3DriverRuntimeOptions = {}) {
    const s3Config: S3StorageConfig = {
      ...config,
      type: 's3',
      region: config.region ?? 'us-east-1',
      forcePathStyle: config.forcePathStyle ?? true,
    };
    this.inner = new S3Driver(s3Config, runtime);
  }

  /** Load the SDK and build the underlying `S3Client`. Awaited by the factory. */
  async ready(): Promise<this> {
    await this.inner.ready();
    return this;
  }

  async upload(
    path: string,
    body: UploadBody,
    options?: UploadOptions<'rustfs'>,
  ): Promise<UploadResult<'rustfs'>> {
    const r = await this.inner.upload(path, body, options as unknown as UploadOptions<'s3'>);
    return { ...r, provider: 'rustfs' as const };
  }

  async download(
    path: string,
    options?: DownloadOptions<'rustfs'>,
  ): Promise<DownloadResult<'rustfs'>> {
    const r = await this.inner.download(path, options as unknown as DownloadOptions<'s3'>);
    return { ...r, provider: 'rustfs' as const };
  }

  async delete(path: string, options?: DeleteOptions<'rustfs'>): Promise<void> {
    return this.inner.delete(path, options as unknown as DeleteOptions<'s3'>);
  }

  async deleteMany(
    paths: string[],
    options?: DeleteManyOptions<'rustfs'>,
  ): Promise<DeleteManyResult> {
    return this.inner.deleteMany(paths, options as unknown as DeleteManyOptions<'s3'>);
  }

  async exists(path: string, options?: ExistsOptions<'rustfs'>): Promise<boolean> {
    return this.inner.exists(path, options as unknown as ExistsOptions<'s3'>);
  }

  async stat(path: string, options?: StatOptions<'rustfs'>): Promise<FileStat<'rustfs'>> {
    const r = await this.inner.stat(path, options as unknown as StatOptions<'s3'>);
    return { ...r, provider: 'rustfs' as const };
  }

  async list(options?: ListOptions<'rustfs'>): Promise<ListResult<'rustfs'>> {
    return this.inner.list(options as unknown as ListOptions<'s3'>) as unknown as Promise<
      ListResult<'rustfs'>
    >;
  }

  async copy(
    source: string,
    destination: string,
    options?: CopyOptions<'rustfs'>,
  ): Promise<CopyResult<'rustfs'>> {
    const r = await this.inner.copy(source, destination, options as unknown as CopyOptions<'s3'>);
    return { ...r, provider: 'rustfs' as const };
  }

  async move(
    source: string,
    destination: string,
    options?: MoveOptions<'rustfs'>,
  ): Promise<MoveResult<'rustfs'>> {
    const r = await this.inner.move(source, destination, options as unknown as MoveOptions<'s3'>);
    return { ...r, provider: 'rustfs' as const };
  }

  async getUrl(path: string, options?: UrlOptions<'rustfs'>): Promise<string> {
    return this.inner.getUrl(path, options as unknown as UrlOptions<'s3'>);
  }

  async getSignedUrl(path: string, options?: SignedUrlOptions<'rustfs'>): Promise<string> {
    return this.inner.getSignedUrl(path, options as unknown as SignedUrlOptions<'s3'>);
  }

  /** The underlying `S3Client` — RustFS has no separate JS SDK. */
  native(): MapValueFor<NativeClientMap, 'rustfs'> {
    return this.inner.native() as MapValueFor<NativeClientMap, 'rustfs'>;
  }

  async nativeRequest<R>(
    fn: (client: MapValueFor<NativeClientMap, 'rustfs'>) => Promise<R>,
  ): Promise<R> {
    return this.inner.nativeRequest(fn as never) as R;
  }

  capabilities(): StorageCapabilities {
    return this.inner.capabilities();
  }
}
