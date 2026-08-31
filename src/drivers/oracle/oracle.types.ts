import type * as OciCommon from 'oci-common';
import type * as OciObjectStorage from 'oci-objectstorage';

/**
 * Oracle Cloud Infrastructure Object Storage configuration using
 * `oci-objectstorage` + `oci-common`.
 *
 * Authentication follows Oracle's native providers — config file,
 * instance principals, resource principals, or a custom provider.
 * Access-key style credentials are intentionally not supported here.
 */
export interface OracleStorageConfig {
  type: 'oracle';
  /** The object storage namespace (stable per tenancy). */
  namespaceName: string;
  bucketName: string;
  region?: string;
  /** Virtual prefix every key is stored under, e.g. `production/`. */
  prefix?: string;
  /** Base URL used by `getUrl()` when a CDN fronts the bucket. */
  publicUrlBase?: string;
  /** Inject a ready authentication provider (wins over `auth`). */
  authProvider?: OciCommon.AuthenticationDetailsProvider;
  /** Declarative authentication; resolved to a native provider. */
  auth?: OracleAuth;
  /** Inject an existing ObjectStorageClient instead of constructing one. */
  client?: OciObjectStorage.ObjectStorageClient;
  /** Extra options forwarded to `new ObjectStorageClient(options)`. */
  clientOptions?: Partial<{ authProvider: OciCommon.AuthenticationDetailsProvider }> &
    Record<string, unknown>;
}

export type OracleAuth =
  | { type: 'config-file'; configFilePath?: string; profile?: string }
  | { type: 'instance-principals' }
  | { type: 'resource-principals' }
  | { type: 'provider'; provider: OciCommon.AuthenticationDetailsProvider };

/**
 * Any {@link OciObjectStorage.requests.PutObjectRequest} field the package
 * does not already map: `storageTier` (`Standard`, `InfrequentAccess`,
 * `Archive`), `contentLanguage`, `ifMatch`, `ifNoneMatch`,
 * `opcChecksumAlgorithm`, ... Note `opcMeta` is accepted here to merge with
 * the common `metadata` bag.
 */
export type OracleNativeUploadOptions = Omit<
  OciObjectStorage.requests.PutObjectRequest,
  | 'namespaceName'
  | 'bucketName'
  | 'objectName'
  | 'contentLength'
  | 'putObjectBody'
  | 'contentType'
  | 'cacheControl'
  | 'contentDisposition'
  | 'contentEncoding'
> & { opcMeta?: Record<string, string> };

export type OracleNativeDownloadOptions = Omit<
  OciObjectStorage.requests.GetObjectRequest,
  'namespaceName' | 'bucketName' | 'objectName' | 'versionId' | 'range'
>;

export type OracleNativeStatOptions = Omit<
  OciObjectStorage.requests.HeadObjectRequest,
  'namespaceName' | 'bucketName' | 'objectName' | 'versionId'
>;

export type OracleNativeDeleteOptions = Omit<
  OciObjectStorage.requests.DeleteObjectRequest,
  'namespaceName' | 'bucketName' | 'objectName' | 'versionId'
>;

/**
 * Extra `ListObjects` fields: `delimiter` defaults to `/` unless listing
 * recursively, `fields` defaults to `name,size,etag,timeModified`,
 * plus `startAfter`, `end`, `opcClientRequestId`, ...
 */
export type OracleNativeListOptions = Omit<
  OciObjectStorage.requests.ListObjectsRequest,
  'namespaceName' | 'bucketName' | 'prefix' | 'limit' | 'start' | 'delimiter' | 'fields'
> & { fields?: string };

/**
 * Overrides for the server-side `CopyObject` call: `destinationRegion`,
 * `destinationNamespace`, `destinationObjectStorageTier`,
 * `destinationMetadata`, `sourceVersionId`, ... Let you copy across
 * regions/tenancies without leaving the abstraction.
 */
export type OracleNativeCopyOptions = Omit<
  OciObjectStorage.models.CopyObjectDetails,
  'sourceObjectName' | 'destinationObjectName' | 'destinationBucket' | 'destinationRegion' | 'destinationNamespace'
> & {
  destinationRegion?: string;
  destinationNamespace?: string;
};

export type OracleNativeSignedUrlOptions = Record<string, never>;

export interface OracleNativeUrlOptions {}

export type OracleNativeClient = OciObjectStorage.ObjectStorageClient;
export type OracleNativeFileStat = OciObjectStorage.responses.HeadObjectResponse;
export type OracleNativeUploadResult =
  | OciObjectStorage.responses.PutObjectResponse
  | OciObjectStorage.responses.CommitMultipartUploadResponse;
export type OracleNativeDownloadResult = Omit<
  OciObjectStorage.responses.GetObjectResponse,
  'value'
>;
export type OracleNativeListResult = OciObjectStorage.responses.ListObjectsResponse;
