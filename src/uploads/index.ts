/**
 * Upload intake: turn the shapes produced by upload middleware (multer,
 * @fastify/multipart, formidable, busboy, web `File`/`Blob`, ...) into
 * `storage.upload()` calls with safe, provider-agnostic object keys.
 *
 * Everything here is dependency-free: framework adapters define structural
 * types instead of importing the framework, so no peer install is required
 * and every storage driver works with every framework.
 */
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type {
  Storage,
  StorageType,
  UploadBody,
  UploadOptions,
  UploadResult,
} from '../core/types';
import { joinKey, normalizeKey } from '../core/paths';

/**
 * A single uploaded file, normalized across upload middleware.
 *
 * `body` accepts anything `Storage.upload()` accepts — a Node stream keeps
 * the request memory-flat for large files; buffers and web `Blob`s work too.
 */
export interface UploadFileInput {
  /** The file content. */
  body: UploadBody;
  /** Form field name the file arrived under. */
  fieldname?: string;
  /** Client-supplied filename. Never trusted for keys — see {@link sanitizeFilename}. */
  originalName?: string;
  /** MIME type as reported by the client. */
  mimeType?: string;
  /** Known size in bytes; forwarded as `contentLength` for stream bodies. */
  size?: number;
}

export interface SaveUploadOptions<T extends string = StorageType> {
  /**
   * Explicit object key, or a resolver receiving the normalized file.
   * String keys are traversal-checked ({@link normalizeKey}). When omitted,
   * a random key under {@link SaveUploadOptions.directory} is generated.
   */
  key?: string | ((file: UploadFileInput) => string | Promise<string>);
  /** Directory prefix for generated keys, e.g. `"uploads"`. */
  directory?: string;
  /** Override the client-reported MIME type. */
  contentType?: string;
  /**
   * Additional metadata merged over the automatic `originalname`,
   * `fieldname` and `mimetype` entries. `false` disables metadata entirely.
   */
  metadata?: Record<string, string> | false;
  /** Forwarded to `upload()`. Defaults to the driver default (true). */
  overwrite?: boolean;
  /** Provider-native upload options, strongly typed per storage type. */
  native?: UploadOptions<T>['native'];
  /** Abort the upload. */
  signal?: AbortSignal;
}

export interface SavedUpload<T extends string = StorageType> {
  /** Key the file was stored under. */
  key: string;
  originalName?: string;
  mimeType?: string;
  /** The raw driver result (etag, versionId, url, native, ...). */
  result: UploadResult<T>;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const UNSAFE_NAME_CHARS = /[<>:"|?*]/g;
const TRAILING_NAME_CHARS = /[. ]+$/;
const NAME_EXTENSION = /\.[A-Za-z0-9]{1,16}$/;
const MAX_FILENAME_LENGTH = 255;

/**
 * Make a client-supplied filename safe to embed in a storage key: keep only
 * the basename, strip control and Windows-hostile characters, cap the
 * length while preserving the extension, and fall back when nothing is left.
 * `.gitignore`-style dotfiles are preserved; `..`-style names are not.
 */
export function sanitizeFilename(name: string | undefined, fallback = 'file'): string {
  if (typeof name !== 'string') return fallback;
  let base = name.split(/[\\/]/).pop() ?? '';
  base = base.replace(CONTROL_CHARS, '').replace(UNSAFE_NAME_CHARS, '').trim();
  if (base === '' || /^\.{1,}$/.test(base)) return fallback;
  if (base.length > MAX_FILENAME_LENGTH) {
    const extension = NAME_EXTENSION.exec(base)?.[0] ?? '';
    base = base.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension;
  }
  base = base.replace(TRAILING_NAME_CHARS, '');
  return base === '' ? fallback : base;
}

/**
 * Generate a random object key: `{directory}/{uuid}{extension}`. The
 * extension is taken from the sanitized original name and lowercased, so
 * `photo.JPG` becomes a `.jpg` key. Never derived from user input beyond
 * the extension — clients cannot choose the stem.
 */
export function randomKey(directory?: string, originalName?: string): string {
  const clean = sanitizeFilename(originalName);
  const extension = NAME_EXTENSION.exec(clean)?.[0]?.toLowerCase() ?? '';
  const key = `${randomUUID()}${extension}`;
  return directory === undefined ? key : normalizeKey(joinKey(directory, key));
}

function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, '');
}

/**
 * Metadata recorded for every upload unless disabled: the original client
 * filename, form field and MIME type — the pieces needed to serve or audit
 * the object later. Values are stripped of control characters so every
 * provider accepts them.
 */
function autoMetadata(file: UploadFileInput): Record<string, string> {
  const metadata: Record<string, string> = {};
  if (file.originalName !== undefined) metadata.originalname = stripControlChars(file.originalName);
  if (file.fieldname !== undefined) metadata.fieldname = stripControlChars(file.fieldname);
  if (file.mimeType !== undefined) metadata.mimetype = file.mimeType;
  return metadata;
}

async function resolveKey<T extends string>(
  options: SaveUploadOptions<T>,
  file: UploadFileInput,
): Promise<string> {
  if (typeof options.key === 'function') return normalizeKey(await options.key(file));
  if (options.key !== undefined) return normalizeKey(options.key);
  return randomKey(options.directory, file.originalName);
}

/**
 * Store an uploaded file on any storage. Resolves the key, derives
 * `contentType` and metadata from the file, and streams the body through.
 *
 * ```ts
 * const saved = await saveUpload(storage, fileFromMiddleware, { directory: 'uploads' });
 * await db.insert(attachments).values({ key: saved.key, name: saved.originalName });
 * ```
 */
export async function saveUpload<T extends string = StorageType>(
  storage: Storage<T>,
  file: UploadFileInput,
  options: SaveUploadOptions<T> = {},
): Promise<SavedUpload<T>> {
  if (file.body === undefined) {
    throw new TypeError('saveUpload requires a file body (stream, buffer or blob)');
  }
  const key = await resolveKey(options, file);
  const contentType = options.contentType ?? file.mimeType;
  const metadata =
    options.metadata === false
      ? undefined
      : { ...autoMetadata(file), ...options.metadata };
  const isStream = file.body instanceof Readable;
  const result = await storage.upload(key, file.body, {
    ...(contentType !== undefined ? { contentType } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(options.overwrite !== undefined ? { overwrite: options.overwrite } : {}),
    ...(file.size !== undefined && isStream ? { contentLength: file.size } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.native !== undefined ? { native: options.native } : {}),
  });
  return {
    key,
    ...(file.originalName !== undefined ? { originalName: file.originalName } : {}),
    ...(file.mimeType !== undefined ? { mimeType: file.mimeType } : {}),
    result,
  };
}

/**
 * Store a web-standard `File`/`Blob` — the shape Hono, Next.js, Remix,
 * Nuxt, Elysia, `Bun.serve` and Deno handlers hand you from
 * `request.formData()`. `File.name`, `type` and `size` are picked up
 * automatically.
 */
export async function saveWebFile<T extends string = StorageType>(
  storage: Storage<T>,
  file: Blob & { name?: string },
  options: SaveUploadOptions<T> = {},
): Promise<SavedUpload<T>> {
  const name = typeof (file as { name?: unknown }).name === 'string'
    ? (file as { name: string }).name
    : undefined;
  return saveUpload(storage, {
    body: file,
    ...(name !== undefined ? { originalName: name } : {}),
    ...(typeof file.type === 'string' && file.type !== '' ? { mimeType: file.type } : {}),
    ...(typeof file.size === 'number' ? { size: file.size } : {}),
  }, options);
}
