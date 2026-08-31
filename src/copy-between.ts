import { Transform } from 'node:stream';

import { StorageError } from './core/errors.js';
import type {
  Storage,
  StorageType,
  UploadResult,
} from './core/types.js';

export interface CopyBetweenOptions {
  /** Part size used by multipart uploads on the destination driver. */
  partSize?: number;
  /** Concurrent part uploads on the destination driver. */
  concurrency?: number;
  contentType?: string;
  metadata?: Record<string, string>;
  overwrite?: boolean;
  signal?: AbortSignal;
  /** Called as the transfer progresses, when the source size is known. */
  onProgress?: (bytesTransferred: number, totalBytes: number | undefined) => void;
}

/**
 * Copy a file between two (possibly different) storage providers by
 * streaming `source.download()` into `destination.upload()`. The file is
 * never fully buffered in memory; multipart options are forwarded to the
 * destination driver.
 *
 * For copies inside a single driver, prefer `storage.copy()`, which uses
 * server-side copy.
 */
export async function copyBetween<
  TSource extends StorageType,
  TDest extends StorageType,
>(
  sourceStorage: Storage<TSource>,
  sourcePath: string,
  destinationStorage: Storage<TDest>,
  destinationPath: string,
  options: CopyBetweenOptions = {},
): Promise<UploadResult<TDest>> {
  const download = await sourceStorage.download(sourcePath, {
    signal: options.signal,
  });

  let bytes = 0;
  const total = download.contentLength;

  // Counting happens inside a Transform: attaching a 'data' listener would
  // switch the stream to flowing mode and siphon chunks away from the
  // consumer the destination driver attaches later.
  const counting = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      options.onProgress?.(bytes, total);
      callback(null, chunk);
    },
  });
  // Forward source errors so the destination upload fails instead of
  // silently writing an incomplete object.
  download.stream.on('error', (error) => counting.destroy(error));
  download.stream.pipe(counting);

  try {
    const metadata = { ...download.metadata, ...options.metadata };
    return await destinationStorage.upload(destinationPath, counting, {
      ...(options.contentType ?? download.contentType
        ? { contentType: options.contentType ?? download.contentType }
        : {}),
      ...(total !== undefined ? { contentLength: total } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      overwrite: options.overwrite ?? true,
      ...(options.partSize !== undefined || options.concurrency !== undefined
        ? {
            multipart: {
              ...(options.partSize !== undefined ? { partSize: options.partSize } : {}),
              ...(options.concurrency !== undefined
                ? { concurrency: options.concurrency }
                : {}),
            },
          }
        : {}),
      signal: options.signal,
    });
  } catch (error) {
    counting.destroy();
    download.stream.destroy();
    if (error instanceof StorageError) throw error;
    throw error;
  } finally {
    if (!counting.readableEnded) counting.destroy();
    if (!download.stream.readableEnded) download.stream.destroy();
  }
}
