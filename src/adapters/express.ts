/**
 * Multer storage engine backed by any storagekit storage.
 *
 * Works everywhere a custom multer `storage` is accepted: Express,
 * NestJS (`FileInterceptor({ storage })`), koa-multer. The engine streams
 * the request straight into the target storage — no disk scratch file, no
 * memory buffering — and exposes the stored key on `req.file.key` plus the
 * full result on `req.file.storagekit`.
 *
 * Multer itself is NOT imported: the engine satisfies multer's
 * `StorageEngine` interface structurally, so multer stays an optional peer.
 */
import type { Readable } from 'node:stream';
import type { Storage, StorageType } from '../core/types';
import { normalizeKey } from '../core/paths';
import {
  saveUpload,
  type SaveUploadOptions,
  type SavedUpload,
  type UploadFileInput,
} from '../uploads';

/**
 * The slice of multer's `File` object the engine touches. Multer's own
 * `File` type is structurally compatible with this — no index signature is
 * declared on purpose, so the engine stays assignable to multer's
 * `StorageEngine` out of the box.
 */
export interface MulterFileLike<T extends string = StorageType> {
  fieldname: string;
  originalname: string;
  mimetype?: string;
  size?: number;
  stream: Readable;
  /** Populated by this engine after a successful upload. */
  storagekit?: SavedUpload<T>;
}

/** Info returned from `_handleFile`; multer merges it onto `req.file`. */
export interface MulterStoredInfo<T extends string = StorageType> {
  key: string;
  size?: number;
  etag?: string;
  url?: string;
  /** Full {@link SavedUpload} — the authoritative handle on the upload. */
  storagekit: SavedUpload<T>;
}

/**
 * Structurally compatible with multer's `StorageEngine`:
 *
 * ```ts
 * const upload = multer({ storage: createMulterStorage(storage) });
 * ```
 */
export interface MulterStorageEngine<T extends string = StorageType> {
  _handleFile(
    req: unknown,
    file: MulterFileLike<T>,
    callback: (error?: unknown, info?: Partial<MulterStoredInfo<T>>) => void,
  ): void;
  _removeFile(
    req: unknown,
    file: MulterFileLike<T>,
    callback: (error: Error | null) => void,
  ): void;
}

export interface MulterStorageOptions<T extends string = StorageType>
  extends Omit<SaveUploadOptions<T>, 'key'> {
  /**
   * Object key or key resolver. Receives the normalized upload (with
   * `originalName`, `fieldname`, `mimeType`, `size`). Defaults to a random
   * key under {@link MulterStorageOptions.directory}.
   */
  key?: string | ((file: UploadFileInput) => string | Promise<string>);
  /** Delete the stored object when multer asks to remove it (request aborted or handler error). Default true. */
  removeOnError?: boolean;
}

/**
 * Create a multer storage engine that persists uploads to `storage`.
 *
 * ```ts
 * import multer from 'multer';
 * const upload = multer({ storage: createMulterStorage(storage, { directory: 'uploads' }) });
 * app.post('/upload', upload.single('avatar'), (req, res) => {
 *   res.json({ key: req.file!.key, name: req.file!.originalname });
 * });
 * ```
 */
export function createMulterStorage<T extends string = StorageType>(
  storage: Storage<T>,
  options: MulterStorageOptions<T> = {},
): MulterStorageEngine<T> {
  return {
    _handleFile(_req, file, callback) {
      const upload = saveUpload(storage, {
        body: file.stream,
        fieldname: file.fieldname,
        originalName: file.originalname,
        ...(file.mimetype !== undefined ? { mimeType: file.mimetype } : {}),
        ...(file.size !== undefined ? { size: file.size } : {}),
      }, options);
      upload.then(
        (saved) => {
          file.storagekit = saved;
          callback(null, {
            key: saved.key,
            ...(saved.result.size !== undefined ? { size: saved.result.size } : {}),
            ...(saved.result.etag !== undefined ? { etag: saved.result.etag } : {}),
            ...(saved.result.url !== undefined ? { url: saved.result.url } : {}),
            storagekit: saved,
          });
        },
        (error: unknown) => callback(error),
      );
    },
    async _removeFile(_req, file, callback) {
      // Multer merges the `_handleFile` info onto the file object, so the
      // `storagekit` record is present; `key` is read defensively for
      // engines wrapped by third parties that may only copy the plain info.
      const fallbackKey = (file as { key?: unknown }).key;
      const key = file.storagekit?.key
        ?? (typeof fallbackKey === 'string' ? fallbackKey : undefined);
      if (options.removeOnError === false || key === undefined) {
        callback(null);
        return;
      }
      try {
        await storage.delete(normalizeKey(key));
        callback(null);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}
