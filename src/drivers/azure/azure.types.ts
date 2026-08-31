import type {
  BlobBeginCopyFromURLOptions,
  BlobDeleteOptions,
  BlobDownloadOptions,
  BlobGetPropertiesOptions,
  BlobRequestConditions,
  BlobSASSignatureValues,
  BlobServiceClient,
  ContainerClient,
  ContainerListBlobsOptions,
  ContainerListBlobHierarchySegmentResponse,
  BlockBlobUploadOptions,
  BlobDownloadResponseParsed,
  BlobGetPropertiesResponse,
  BlobDeleteResponse,
  BlobBeginCopyFromURLResponse,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
import type { TokenCredential } from '@azure/core-auth';

/**
 * Azure Blob Storage configuration using `@azure/storage-blob`.
 *
 * Authentication supports connection strings, shared keys, `TokenCredential`
 * (including managed identity via @azure/identity), or injecting an existing
 * service/container client.
 */
export interface AzureStorageConfig {
  type: 'azure';
  container: string;
  /** Virtual prefix every key is stored under, e.g. `production/`. */
  prefix?: string;
  /** Base URL used by `getUrl()` when a CDN fronts the container. */
  publicUrlBase?: string;
  connectionString?: string;
  accountUrl?: string;
  credential?: StorageSharedKeyCredential | TokenCredential;
  serviceClient?: BlobServiceClient;
  containerClient?: ContainerClient;
}

/**
 * Extra fields for blob uploads: access `tier` (`Hot`, `Cool`, `Cold`,
 * `Archive`), `conditions`, `tags`, `blobHTTPHeaders`. Common HTTP headers
 * are mapped into `blobHTTPHeaders` automatically and native wins on clash.
 */
export type AzureNativeUploadOptions = Omit<
  BlockBlobUploadOptions,
  'metadata' | 'abortSignal' | 'tracingOptions'
>;

export type AzureNativeDownloadOptions = Omit<
  BlobDownloadOptions,
  'abortSignal' | 'tracingOptions' | 'onProgress'
>;

export type AzureNativeStatOptions = Omit<
  BlobGetPropertiesOptions,
  'abortSignal' | 'tracingOptions' | 'conditions'
> & { conditions?: BlobRequestConditions };

export type AzureNativeDeleteOptions = Omit<
  BlobDeleteOptions,
  'abortSignal' | 'tracingOptions'
>;

export type AzureNativeDeleteManyOptions = Record<string, never>;

export type AzureNativeListOptions = Omit<
  ContainerListBlobsOptions,
  'prefix' | 'abortSignal' | 'tracingOptions' | 'include'
>;

export type AzureNativeCopyOptions = Omit<
  BlobBeginCopyFromURLOptions,
  'abortSignal' | 'tracingOptions' | 'metadata' | 'blobHTTPHeaders' | 'conditions'
> & { conditions?: BlobRequestConditions };

/**
 * Overrides for the generated SAS: `expiresOn` (instead of `expiresIn`),
 * `protocol` (https/http), `startTime`, `ipRange`, `identifier` (stored
 * access policy), `cacheControl`, `contentDisposition`, `contentType`, ...
 */
export type AzureNativeSignedUrlOptions = Omit<
  Partial<BlobSASSignatureValues>,
  'containerName' | 'blobName' | 'permissions' | 'version'
>;

export interface AzureNativeUrlOptions {}

export type AzureNativeClient = ContainerClient;
export type AzureNativeFileStat = BlobGetPropertiesResponse;
export type AzureNativeUploadResult = { etag?: string; versionId?: string };
export type AzureNativeDownloadResult = Omit<BlobDownloadResponseParsed, 'readableStreamBody' | 'blobBody'>;
export type AzureNativeListResult = ContainerListBlobHierarchySegmentResponse;
export type AzureNativeDeleteResult = BlobDeleteResponse;
export type AzureNativeCopyResult = BlobBeginCopyFromURLResponse;
