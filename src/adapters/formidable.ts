/**
 * Adapter for formidable (v2/v3) uploaded files.
 *
 * Formidable writes uploads to a temporary file before your handler runs;
 * this adapter streams that temp file into storage. Formidable is NOT
 * imported — the file shape is structural, so the package stays an
 * optional peer.
 */
import { createReadStream } from 'node:fs';
import type { Storage, StorageType } from '../core/types';
import {
  saveUpload,
  type SaveUploadOptions,
  type SavedUpload,
} from '../uploads';

/**
 * The slice of a formidable `File` (v2 plain object, v3 class) this
 * adapter touches.
 */
export interface FormidableFileLike {
  /** Path of the temp file formidable wrote the upload to. */
  filepath: string;
  originalFilename?: string;
  mimetype?: string;
  size?: number;
}

/**
 * Store a formidable file on any storage.
 *
 * ```ts
 * form.parse(req, async (err, fields, files) => {
 *   const upload = Array.isArray(files.file) ? files.file[0] : files.file;
 *   const saved = await saveFormidableFile(storage, upload, { directory: 'uploads' });
 *   res.end(JSON.stringify({ key: saved.key }));
 * });
 * ```
 */
export async function saveFormidableFile<T extends string = StorageType>(
  storage: Storage<T>,
  file: FormidableFileLike,
  options: SaveUploadOptions<T> = {},
): Promise<SavedUpload<T>> {
  return saveUpload(storage, {
    body: createReadStream(file.filepath),
    originalName: file.originalFilename,
    ...(file.mimetype !== undefined ? { mimeType: file.mimetype } : {}),
    ...(file.size !== undefined ? { size: file.size } : {}),
  }, options);
}
