import { createStorage } from '../../factory';
import type { Storage } from '../../core/types';
import type { OracleStorageConfig } from './oracle.types';

export { OracleDriver } from './oracle.driver';
export type {
  OracleStorageConfig,
  OracleAuth,
  OracleNativeUploadOptions,
  OracleNativeDownloadOptions,
  OracleNativeStatOptions,
  OracleNativeDeleteOptions,
  OracleNativeListOptions,
  OracleNativeCopyOptions,
  OracleNativeSignedUrlOptions,
  OracleNativeUrlOptions,
  OracleNativeClient,
  OracleNativeFileStat,
  OracleNativeUploadResult,
  OracleNativeDownloadResult,
  OracleNativeListResult,
} from './oracle.types';
export type { Storage } from '../../core/types';

/**
 * Oracle-flavored storage with the provider-specific extras that do not fit
 * the generic interface: Oracle has no presigned URLs — it uses
 * pre-authenticated requests (PARs), whose lifecycle is fundamentally
 * different from a presigned URL.
 */
export interface OracleStorage extends Storage<'oracle'> {
  /**
   * Create a pre-authenticated request for an object (or prefix).
   * This is a persistent server-side resource — delete it when done via
   * `nativeRequest()` with deletePreauthenticatedRequest.
   */
  createPreauthenticatedRequest(options: {
    objectName?: string;
    objectPrefix?: string;
    accessType: string;
    timeExpires: Date;
    name: string;
    bucketListingAction?: string;
  }): Promise<{ accessUri: string; id: string }>;
}

/**
 * Create an Oracle Cloud Infrastructure Object Storage. Direct entrypoint —
 * importing this module never loads the other providers' SDKs.
 */
export async function createOracleStorage(
  config: OracleStorageConfig,
  options?: Parameters<typeof createStorage>[1],
): Promise<OracleStorage> {
  const storage = (await createStorage(config, options)) as Storage<'oracle'>;
  const oracleStorage = storage as OracleStorage;
  oracleStorage.createPreauthenticatedRequest = async (par) => {
    const response = await storage.nativeRequest((client) =>
      client.createPreauthenticatedRequest({
        namespaceName: config.namespaceName,
        bucketName: config.bucketName,
        createPreauthenticatedRequestDetails: {
          name: par.name,
          accessType: par.accessType,
          timeExpires: par.timeExpires,
          ...(par.objectName !== undefined ? { objectName: par.objectName } : {}),
          ...(par.objectPrefix !== undefined
            ? { objectPrefix: par.objectPrefix }
            : {}),
          ...(par.bucketListingAction !== undefined
            ? { bucketListingAction: par.bucketListingAction }
            : {}),
        },
      } as never),
    );
    const like = response as unknown as {
      preauthenticatedRequest?: { accessUri?: string; id?: string };
    };
    return {
      accessUri: like.preauthenticatedRequest?.accessUri ?? '',
      id: like.preauthenticatedRequest?.id ?? '',
    };
  };
  return oracleStorage;
}
