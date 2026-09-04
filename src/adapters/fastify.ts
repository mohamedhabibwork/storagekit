/**
 * Adapter for `@fastify/multipart` file parts (Fastify 4/5).
 *
 * The file is streamed — never buffered — by delegating the part's Node
 * stream to {@link saveUpload}. `@fastify/multipart` is NOT imported: the
 * part type is structural, so the package stays an optional peer.
 */
import type { Readable } from 'node:stream';
import type { Storage, StorageType } from '../core/types';
import {
  saveUpload,
  type SaveUploadOptions,
  type SavedUpload,
} from '../uploads';

/**
 * The slice of a `@fastify/multipart` `MultipartFile` this adapter touches.
 */
export interface FastifyMultipartFileLike {
  fieldname?: string;
  filename: string;
  encoding?: string;
  mimetype?: string;
  /** The raw part stream; consumed by the storage upload. */
  file: Readable;
  toBuffer(): Promise<Buffer>;
}

/**
 * Store a `@fastify/multipart` part on any storage.
 *
 * ```ts
 * app.post('/upload', async (req, reply) => {
 *   const part = await req.file();
 *   if (!part) return reply.code(400).send({ error: 'no file' });
 *   const saved = await saveFastifyFile(storage, part, { directory: 'uploads' });
 *   return { key: saved.key, name: saved.originalName };
 * });
 * ```
 *
 * The part stream must be fully consumed before the reply is sent; a
 * successful `saveFastifyFile` consumes it, and on failure the stream is
 * destroyed so Fastify can settle the request.
 */
export async function saveFastifyFile<T extends string = StorageType>(
  storage: Storage<T>,
  file: FastifyMultipartFileLike,
  options: SaveUploadOptions<T> = {},
): Promise<SavedUpload<T>> {
  try {
    return await saveUpload(storage, {
      body: file.file,
      ...(file.fieldname !== undefined ? { fieldname: file.fieldname } : {}),
      originalName: file.filename,
      ...(file.mimetype !== undefined ? { mimeType: file.mimetype } : {}),
    }, options);
  } catch (error) {
    file.file.destroy();
    throw error;
  }
}
