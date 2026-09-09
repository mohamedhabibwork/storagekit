import type { S3StorageConfig } from '../s3/s3.types';

/**
 * Cloudflare R2 storage configuration.
 *
 * R2 exposes an S3-compatible API, so this driver uses the AWS SDK v3. Pass
 * either `accountId` (to derive R2's standard endpoint) or a full `endpoint`
 * for jurisdictional endpoints and other advanced setups.
 */
export interface R2StorageConfig {
  type: 'r2';
  bucket: string;
  /** Cloudflare account ID used to derive `https://<id>.r2.cloudflarestorage.com`. */
  accountId?: string;
  /** Full S3-compatible R2 endpoint. Takes precedence over `accountId`. */
  endpoint?: string;
  /** Defaults to `auto`, the region required by R2's S3 API. */
  region?: string;
  credentials?: S3StorageConfig['credentials'];
  /** Use path-style requests. Defaults to false, matching R2's SDK examples. */
  forcePathStyle?: boolean;
  /** Virtual prefix every key is stored under, e.g. `production/`. */
  prefix?: string;
  /** Public bucket or custom-domain base URL used by `getUrl()`. */
  publicUrlBase?: string;
  /** Inject an existing `S3Client` instead of constructing one. */
  client?: S3StorageConfig['client'];
  /** Extra options forwarded to `new S3Client(options)`. */
  clientOptions?: S3StorageConfig['clientOptions'];
}

export type { S3StorageConfig };
