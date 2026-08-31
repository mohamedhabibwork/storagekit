import type {
  CompleteMultipartUploadOutput,
  GetObjectCommandInput,
  GetObjectCommandOutput,
  HeadObjectCommandOutput,
  ListObjectsV2CommandInput,
  ListObjectsV2CommandOutput,
  ObjectCannedACL,
  PutObjectCommandInput,
  S3Client,
  S3ClientConfig,
  CopyObjectCommandInput,
  DeleteObjectCommandInput,
  DeleteObjectsCommandInput,
  HeadObjectCommandInput,
} from '@aws-sdk/client-s3';
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';

/**
 * AWS S3 storage configuration, backed by the official SDK v3
 * (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`).
 */
export interface S3StorageConfig {
  type: 's3';
  bucket: string;
  region?: string;
  endpoint?: string;
  credentials?:
    | {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
      }
    | AwsCredentialIdentityProvider;
  forcePathStyle?: boolean;
  /** Virtual prefix every key is stored under, e.g. `production/`. */
  prefix?: string;
  /** Base URL used by `getUrl()` when a CDN fronts the bucket. */
  publicUrlBase?: string;
  /** Inject an existing S3Client instead of constructing one. */
  client?: S3Client;
  /** Extra options forwarded to `new S3Client(options)`. */
  clientOptions?: Partial<S3ClientConfig>;
}

/**
 * Any {@link PutObjectCommandInput} field the package does not already map,
 * merged last so it overrides common equivalents. Includes `StorageClass`,
 * `ServerSideEncryption`, `SSEKMSKeyId`, `ACL`, `Tagging`, `ChecksumAlgorithm`,
 * `IfNoneMatch` (when the bucket is configured for it) and friends.
 */
export type S3NativeUploadOptions = Omit<
  PutObjectCommandInput,
  | 'Bucket'
  | 'Key'
  | 'Body'
  | 'ContentType'
  | 'ContentLength'
  | 'Metadata'
  | 'CacheControl'
  | 'ContentDisposition'
  | 'ContentEncoding'
> & { ACL?: ObjectCannedACL };

export type S3NativeDownloadOptions = Omit<
  GetObjectCommandInput,
  'Bucket' | 'Key' | 'Range' | 'VersionId'
>;

export type S3NativeStatOptions = Omit<
  HeadObjectCommandInput,
  'Bucket' | 'Key' | 'VersionId'
>;

export type S3NativeDeleteOptions = Omit<
  DeleteObjectCommandInput,
  'Bucket' | 'Key' | 'VersionId'
>;

export type S3NativeDeleteManyOptions = Omit<
  DeleteObjectsCommandInput,
  'Bucket' | 'Delete'
>;

/**
 * Extra fields for `ListObjectsV2`: `ExpectedBucketOwner`, `RequestPayer`,
 * `OptionalObjectAttributes`, and so on.
 */
export type S3NativeListOptions = Omit<
  ListObjectsV2CommandInput,
  'Bucket' | 'Prefix' | 'MaxKeys' | 'ContinuationToken' | 'Delimiter' | 'StartAfter'
>;

/**
 * Extra fields for `CopyObject`: `CopySourceIfMatch`, `CopySourceIfNoneMatch`,
 * `CopySourceServerSideEncryptionCustomerKeys`, `RequestPayer`, ...
 */
export type S3NativeCopyOptions = Omit<
  CopyObjectCommandInput,
  | 'Bucket'
  | 'Key'
  | 'CopySource'
  | 'ContentType'
  | 'Metadata'
  | 'CacheControl'
  | 'ContentDisposition'
  | 'ContentEncoding'
  | 'MetadataDirective'
>;

/**
 * Signed URL native options are merged into the underlying command input.
 * For reads that means `ResponseContentDisposition`, `ResponseContentType`,
 * `VersionId`, etc.; for writes any `PutObjectCommandInput` field.
 */
export type S3NativeSignedUrlOptions = Omit<
  GetObjectCommandInput & PutObjectCommandInput & DeleteObjectCommandInput,
  'Bucket' | 'Key'
>;

export interface S3NativeUrlOptions {
  /** Force path-style URLs even when `forcePathStyle` is not configured. */
  forcePathStyle?: boolean;
}

export type S3NativeClient = S3Client;
export type S3NativeFileStat = HeadObjectCommandOutput;
export type S3NativeUploadResult = CompleteMultipartUploadOutput;
export type S3NativeDownloadResult = Omit<GetObjectCommandOutput, 'Body'>;
export type S3NativeListResult = ListObjectsV2CommandOutput;
