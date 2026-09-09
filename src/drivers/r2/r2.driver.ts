import { S3Driver } from '../s3/s3.driver';
import type { S3DriverRuntimeOptions } from '../s3/s3.driver';
import type { S3StorageConfig } from '../s3/s3.types';
import type {
  CopyOptions, CopyResult, DeleteManyOptions, DeleteManyResult, DeleteOptions,
  DownloadOptions, DownloadResult, ExistsOptions, FileStat, ListOptions,
  ListResult, MoveOptions, MoveResult, SignedUrlOptions, StatOptions,
  StorageCapabilities, UploadBody, UploadOptions, UploadResult, UrlOptions,
} from '../../core/types';
import type { MapValueFor, NativeClientMap } from '../../core/maps';
import type { StorageDriver } from '../driver';
import type { R2StorageConfig } from './r2.types';

/** Cloudflare R2 driver, implemented through R2's S3-compatible API. */
export class R2Driver implements StorageDriver<'r2'> {
  readonly type = 'r2' as const;
  private readonly inner: S3Driver;

  constructor(config: R2StorageConfig, runtime: S3DriverRuntimeOptions = {}) {
    const endpoint = config.endpoint ??
      (config.accountId ? `https://${config.accountId}.r2.cloudflarestorage.com` : undefined);
    const s3Config: S3StorageConfig = {
      ...config,
      type: 's3',
      endpoint,
      region: config.region ?? 'auto',
      forcePathStyle: config.forcePathStyle ?? false,
    };
    this.inner = new S3Driver(s3Config, runtime);
  }

  async ready(): Promise<this> { await this.inner.ready(); return this; }
  async upload(path: string, body: UploadBody, options?: UploadOptions<'r2'>): Promise<UploadResult<'r2'>> {
    return { ...await this.inner.upload(path, body, options as unknown as UploadOptions<'s3'>), provider: 'r2' };
  }
  async download(path: string, options?: DownloadOptions<'r2'>): Promise<DownloadResult<'r2'>> {
    return { ...await this.inner.download(path, options as unknown as DownloadOptions<'s3'>), provider: 'r2' };
  }
  async delete(path: string, options?: DeleteOptions<'r2'>): Promise<void> { return this.inner.delete(path, options as unknown as DeleteOptions<'s3'>); }
  async deleteMany(paths: string[], options?: DeleteManyOptions<'r2'>): Promise<DeleteManyResult> { return this.inner.deleteMany(paths, options as unknown as DeleteManyOptions<'s3'>); }
  async exists(path: string, options?: ExistsOptions<'r2'>): Promise<boolean> { return this.inner.exists(path, options as unknown as ExistsOptions<'s3'>); }
  async stat(path: string, options?: StatOptions<'r2'>): Promise<FileStat<'r2'>> { return { ...await this.inner.stat(path, options as unknown as StatOptions<'s3'>), provider: 'r2' }; }
  async list(options?: ListOptions<'r2'>): Promise<ListResult<'r2'>> { return this.inner.list(options as unknown as ListOptions<'s3'>) as unknown as Promise<ListResult<'r2'>>; }
  async copy(source: string, destination: string, options?: CopyOptions<'r2'>): Promise<CopyResult<'r2'>> { return { ...await this.inner.copy(source, destination, options as unknown as CopyOptions<'s3'>), provider: 'r2' }; }
  async move(source: string, destination: string, options?: MoveOptions<'r2'>): Promise<MoveResult<'r2'>> { return { ...await this.inner.move(source, destination, options as unknown as MoveOptions<'s3'>), provider: 'r2' }; }
  async getUrl(path: string, options?: UrlOptions<'r2'>): Promise<string> { return this.inner.getUrl(path, options as unknown as UrlOptions<'s3'>); }
  async getSignedUrl(path: string, options?: SignedUrlOptions<'r2'>): Promise<string> { return this.inner.getSignedUrl(path, options as unknown as SignedUrlOptions<'s3'>); }
  native(): MapValueFor<NativeClientMap, 'r2'> { return this.inner.native() as MapValueFor<NativeClientMap, 'r2'>; }
  async nativeRequest<R>(fn: (client: MapValueFor<NativeClientMap, 'r2'>) => Promise<R>): Promise<R> { return this.inner.nativeRequest(fn as never) as R; }
  capabilities(): StorageCapabilities { return { ...this.inner.capabilities(), versioning: false }; }
}
