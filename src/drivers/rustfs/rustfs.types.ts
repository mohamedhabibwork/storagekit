import type { S3StorageConfig } from '../s3/s3.types';

/**
 * RustFS storage configuration. RustFS is an Apache-2.0 S3-compatible
 * object storage written in Rust that ships no first-party JS SDK — it
 * speaks the AWS S3 API, so storagekit drives it with the official AWS
 * SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`,
 * `@aws-sdk/s3-request-presigner`) configured to point at your RustFS
 * endpoint.
 *
 * All RustFS-specific defaults are baked in by the factory: when you do
 * not pass `region` or `forcePathStyle`, the driver uses `us-east-1`
 * and `forcePathStyle: true` (RustFS' defaults). See
 * <https://docs.rustfs.com/en/developer/sdk/javascript> for the upstream
 * quick-start that this driver mirrors.
 */
export interface RustfsStorageConfig {
  type: 'rustfs';
  bucket: string;
  /** RustFS endpoint, e.g. `http://localhost:9000`. Required. */
  endpoint: string;
  /** Defaults to `us-east-1` (RustFS' default region). */
  region?: string;
  credentials?:
    | {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
      }
    | import('@aws-sdk/types').AwsCredentialIdentityProvider;
  /**
   * Defaults to `true` (RustFS uses path-style URLs by default).
   * Virtual-host style requires `RUSTFS_SERVER_DOMAINS` to be set on
   * the server.
   */
  forcePathStyle?: boolean;
  /** Virtual prefix every key is stored under, e.g. `production/`. */
  prefix?: string;
  /** Base URL used by `getUrl()` when a CDN fronts the bucket. */
  publicUrlBase?: string;
  /** Inject an existing `S3Client` instead of constructing one. */
  client?: import('@aws-sdk/client-s3').S3Client;
  /** Extra options forwarded to `new S3Client(options)`. */
  clientOptions?: Partial<import('@aws-sdk/client-s3').S3ClientConfig>;
}

/**
 * Re-export the S3 config so consumers who import from the rustfs
 * subpath can see the underlying shape without having to import from
 * `storagekit/s3` directly.
 */
export type { S3StorageConfig };
