import { Readable } from 'node:stream';
import type { UploadBody } from './primitives';

/**
 * Normalize any {@link UploadBody} into a Node `Readable`. Buffers, strings
 * and other in-memory values are wrapped without copies; web streams and
 * blobs are piped through their native stream adapters.
 */
export function bodyToReadable(body: UploadBody): Readable {
  if (body instanceof Readable) return body;

  if (typeof body === 'string') {
    return Readable.from(Buffer.from(body, 'utf8'));
  }
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return Readable.from(Buffer.from(body));
  }
  if (body instanceof ArrayBuffer) {
    return Readable.from(Buffer.from(body));
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    const webStream = body.stream() as unknown as ReadableStream;
    if (typeof Readable.fromWeb === 'function') {
      return Readable.fromWeb(webStream as never);
    }
    throw new TypeError('Blob bodies require Node.js >= 18');
  }
  throw new TypeError(`Unsupported upload body: ${typeof body}`);
}

/**
 * Best-effort byte length of an upload body, when known without reading
 * the whole stream.
 */
export function bodyLength(body: UploadBody): number | undefined {
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
  if (Buffer.isBuffer(body)) return body.length;
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return undefined;
}

/** Convert an SDK response body (Node or web stream, blob, buffer) to a Node Readable. */
export function toReadable(value: unknown): Readable {
  if (value instanceof Readable) return value;
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return bodyToReadable(value as unknown as UploadBody);
  }
  if (value && typeof (value as ReadableStream).getReader === 'function') {
    return Readable.fromWeb(value as never);
  }
  if (value && typeof (value as Readable).pipe === 'function') {
    return value as Readable;
  }
  if (Buffer.isBuffer(value)) return Readable.from(value);
  throw new TypeError(`Cannot convert ${typeof value} to a Readable stream`);
}

/** Collect a stream into a Buffer. */
export function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Split a readable stream into `partSize` chunks, holding at most one chunk
 * in memory at a time. Used to drive native multipart uploads from a stream.
 */
export async function* chunkStream(
  stream: Readable,
  partSize: number,
): AsyncGenerator<Buffer> {
  let pending: Buffer[] = [];
  let pendingLength = 0;
  for await (const chunk of stream) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    let offset = 0;
    while (offset < buffer.length) {
      const take = Math.min(partSize - pendingLength, buffer.length - offset);
      pending.push(buffer.subarray(offset, offset + take));
      pendingLength += take;
      offset += take;
      if (pendingLength === partSize) {
        yield Buffer.concat(pending);
        pending = [];
        pendingLength = 0;
      }
    }
  }
  if (pendingLength > 0) yield Buffer.concat(pending);
}

/** Run async tasks with bounded concurrency, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const runners = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Strip the surrounding quotes providers put on ETags. */
export function cleanEtag(etag: string | undefined | null): string | undefined {
  if (!etag) return undefined;
  return etag.replace(/^"(.*)"$/, '$1');
}
