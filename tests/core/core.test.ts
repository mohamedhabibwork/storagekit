import { describe, expect, it } from 'vitest';

import {
  StorageError,
  StorageInvalidPathError,
  StorageNotFoundError,
  StoragePermissionError,
  StorageQuotaError,
  normalizeError,
} from '../../src/core/errors';
import { normalizeKey, joinKey, stripKey, encodeKeyPath, resolveInsideRoot } from '../../src/core/paths';
import { chunkStream, mapWithConcurrency, cleanEtag } from '../../src/core/streams';
import { detectContentTypeFromPath } from '../../src/core/mime';
import { Readable } from 'node:stream';

describe('normalizeKey', () => {
  it('normalizes separators, dots and slashes', () => {
    expect(normalizeKey('a/b/c.txt')).toBe('a/b/c.txt');
    expect(normalizeKey('\\windows\\style\\path')).toBe('windows/style/path');
    expect(normalizeKey('/leading/slash/')).toBe('leading/slash');
    expect(normalizeKey('a//b///c')).toBe('a/b/c');
    expect(normalizeKey('./a/./b')).toBe('a/b');
  });

  it('rejects traversal and empty paths', () => {
    expect(() => normalizeKey('../secret')).toThrow(StorageInvalidPathError);
    expect(() => normalizeKey('a/../b')).toThrow(StorageInvalidPathError);
    expect(() => normalizeKey('')).toThrow(StorageInvalidPathError);
    expect(() => normalizeKey('/')).toThrow(StorageInvalidPathError);
  });
});

describe('key helpers', () => {
  it('joins and strips prefixes', () => {
    expect(joinKey('production', 'users/a.txt')).toBe('production/users/a.txt');
    expect(joinKey('production/', 'users/a.txt')).toBe('production/users/a.txt');
    expect(joinKey(undefined, 'a.txt')).toBe('a.txt');
    expect(stripKey('production', 'production/users/a.txt')).toBe('users/a.txt');
    expect(stripKey('production', 'other/a.txt')).toBe('other/a.txt');
    expect(stripKey(undefined, 'a.txt')).toBe('a.txt');
  });

  it('encodes path segments but keeps slashes', () => {
    expect(encodeKeyPath('files/my file (1).txt')).toBe('files/my%20file%20(1).txt');
    expect(encodeKeyPath('a/b')).toBe('a/b');
  });

  it('resolveInsideRoot keeps paths inside the root', () => {
    const resolved = resolveInsideRoot('/tmp/root', 'a/b.txt');
    expect(resolved.startsWith('/tmp/root')).toBe(true);
    expect(() => resolveInsideRoot('/tmp/root', '../outside.txt')).toThrow(StorageInvalidPathError);
  });
});

describe('normalizeError', () => {
  it('maps provider status codes and keeps cause', () => {
    const original = Object.assign(new Error('nope'), {
      $metadata: { httpStatusCode: 404 },
      name: 'NoSuchKey',
    });
    const error = normalizeError(original, { provider: 's3', operation: 'download', path: 'x' });
    expect(error).toBeInstanceOf(StorageNotFoundError);
    expect(error.provider).toBe('s3');
    expect(error.operation).toBe('download');
    expect(error.path).toBe('x');
    expect(error.cause).toBe(original);
  });

  it('maps permission and quota errors', () => {
    expect(
      normalizeError(Object.assign(new Error('denied'), { statusCode: 403 }), {
        provider: 'azure',
        operation: 'list',
      }),
    ).toBeInstanceOf(StoragePermissionError);
    expect(
      normalizeError(Object.assign(new Error('full'), { statusCode: 507 }), {
        provider: 's3',
        operation: 'upload',
      }),
    ).toBeInstanceOf(StorageQuotaError);
  });

  it('passes package errors through untouched', () => {
    const error = new StorageNotFoundError('already normalized');
    expect(normalizeError(error, { provider: 'local', operation: 'x' })).toBe(error);
  });
});

describe('stream helpers', () => {
  it('chunks streams without dropping bytes', async () => {
    const buffer = Buffer.alloc(10, 3);
    const parts: Buffer[] = [];
    for await (const part of chunkStream(Readable.from(buffer), 4)) {
      parts.push(part);
    }
    expect(Buffer.concat(parts).equals(buffer)).toBe(true);
    expect(parts.map((p) => p.length)).toEqual([4, 4, 2]);
  });

  it('runs workers with bounded concurrency', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('cleans quoted etags', () => {
    expect(cleanEtag('"abc"')).toBe('abc');
    expect(cleanEtag('abc')).toBe('abc');
    expect(cleanEtag(undefined)).toBeUndefined();
  });
});

describe('mime', () => {
  it('detects common types from extensions', () => {
    expect(detectContentTypeFromPath('a/b/c.png')).toBe('image/png');
    expect(detectContentTypeFromPath('movie.MP4')).toBe('video/mp4');
    expect(detectContentTypeFromPath('no-extension')).toBeUndefined();
    expect(detectContentTypeFromPath('.hidden')).toBeUndefined();
  });
});
