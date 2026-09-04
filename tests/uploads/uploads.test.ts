import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';

import {
  randomKey,
  saveUpload,
  saveWebFile,
  sanitizeFilename,
  type SavedUpload,
  type UploadFileInput,
} from '../../src/uploads';
import { StorageInvalidPathError } from '../../src/core/errors';
import type { Storage, UploadOptions, UploadResult } from '../../src/core/types';

interface RecordedUpload {
  path: string;
  body: unknown;
  options: UploadOptions;
}

function stubStorage() {
  const uploads: RecordedUpload[] = [];
  const storage = {
    type: 'local',
    upload: async (
      path: string,
      body: UploadFileInput['body'],
      options: UploadOptions,
    ): Promise<UploadResult> => {
      uploads.push({ path, body, options });
      return { path, provider: 'local', etag: 'etag-1' };
    },
  } as unknown as Storage<'local'>;
  return { storage, uploads };
}

describe('sanitizeFilename', () => {
  it('keeps clean names and extensions', () => {
    expect(sanitizeFilename('report.pdf')).toBe('report.pdf');
    expect(sanitizeFilename('my-photo (2).JPEG')).toBe('my-photo (2).JPEG');
    expect(sanitizeFilename('.gitignore')).toBe('.gitignore');
  });

  it('reduces paths to the basename on both separators', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\me\\cv.docx')).toBe('cv.docx');
    expect(sanitizeFilename('a/b/../c.txt')).toBe('c.txt');
  });

  it('strips control and Windows-hostile characters', () => {
    expect(sanitizeFilename('my <file>: "x"?.png')).toBe('my file x.png');
    expect(sanitizeFilename('bad\u0000\u001fname.txt')).toBe('badname.txt');
  });

  it('falls back when nothing usable is left', () => {
    expect(sanitizeFilename(undefined)).toBe('file');
    expect(sanitizeFilename('')).toBe('file');
    expect(sanitizeFilename('..')).toBe('file');
    expect(sanitizeFilename('???')).toBe('file');
    expect(sanitizeFilename('...', 'upload.bin')).toBe('upload.bin');
  });

  it('caps the length while preserving the extension', () => {
    const long = `${'a'.repeat(300)}.pdf`;
    const cleaned = sanitizeFilename(long);
    expect(cleaned.length).toBeLessThanOrEqual(255);
    expect(cleaned.endsWith('.pdf')).toBe(true);
  });
});

describe('randomKey', () => {
  it('generates a uuid key with a lowercased extension under the directory', () => {
    const key = randomKey('uploads', 'Photo.JPG');
    expect(key).toMatch(/^uploads\/[0-9a-f-]{36}\.jpg$/);
    const other = randomKey('uploads', 'Photo.JPG');
    expect(other).not.toBe(key);
  });

  it('works without a directory and without an original name', () => {
    expect(randomKey()).toMatch(/^[0-9a-f-]{36}$/);
    expect(randomKey(undefined, 'no-extension')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never lets the original name contribute a stem or traversal', () => {
    const key = randomKey('uploads', '../../etc/hosts');
    expect(key).toMatch(/^uploads\//);
    expect(key).not.toContain('hosts');
    expect(key).not.toContain('..');
  });
});

describe('saveUpload', () => {
  it('generates a random key under the directory and derives contentType/metadata', async () => {
    const { storage, uploads } = stubStorage();
    const saved = await saveUpload(storage, {
      body: Buffer.from('hello'),
      fieldname: 'avatar',
      originalName: 'me.png',
      mimeType: 'image/png',
      size: 5,
    }, { directory: 'users/42' });

    expect(saved.key).toMatch(/^users\/42\/[0-9a-f-]{36}\.png$/);
    expect(saved.originalName).toBe('me.png');
    expect(saved.mimeType).toBe('image/png');
    expect(saved.result.etag).toBe('etag-1');

    const call = uploads[0]!;
    expect(call.path).toBe(saved.key);
    expect(call.options.contentType).toBe('image/png');
    expect(call.options.metadata).toEqual({
      originalname: 'me.png',
      fieldname: 'avatar',
      mimetype: 'image/png',
    });
    // Buffer bodies already know their length — contentLength not forced.
    expect(call.options.contentLength).toBeUndefined();
  });

  it('uses an explicit key and passes overwrite through', async () => {
    const { storage, uploads } = stubStorage();
    const saved = await saveUpload(storage, { body: 'x' }, {
      key: 'docs/readme.md',
      overwrite: false,
    });
    expect(saved.key).toBe('docs/readme.md');
    expect(uploads[0]!.options.overwrite).toBe(false);
  });

  it('rejects traversal from key strings and key functions', async () => {
    const { storage } = stubStorage();
    await expect(
      saveUpload(storage, { body: 'x' }, { key: '../escape.txt' }),
    ).rejects.toThrow(StorageInvalidPathError);
    await expect(
      saveUpload(storage, { body: 'x' }, { key: () => Promise.resolve('a/../../escape') }),
    ).rejects.toThrow(StorageInvalidPathError);
  });

  it('key functions receive the normalized file input', async () => {
    const { storage } = stubStorage();
    const seen: UploadFileInput[] = [];
    await saveUpload(storage, {
      body: 'x',
      fieldname: 'doc',
      originalName: 'a.pdf',
      mimeType: 'application/pdf',
    }, {
      key: (file) => {
        seen.push(file);
        return `by-user/${file.originalName}`;
      },
    });
    expect(seen[0]!.originalName).toBe('a.pdf');
    expect(seen[0]!.mimeType).toBe('application/pdf');
  });

  it('sets contentLength on stream bodies with a known size', async () => {
    const { storage, uploads } = stubStorage();
    await saveUpload(storage, {
      body: Readable.from(Buffer.from('streamed')),
      originalName: 'clip.mp4',
      mimeType: 'video/mp4',
      size: 8,
    }, { directory: 'videos' });
    expect(uploads[0]!.options.contentLength).toBe(8);
  });

  it('metadata: false disables metadata; extra metadata merges over automatic', async () => {
    const { storage, uploads } = stubStorage();
    await saveUpload(storage, { body: 'x', originalName: 'a.txt', mimeType: 'text/plain' }, {
      key: 'one',
      metadata: false,
    });
    expect(uploads[0]!.options.metadata).toBeUndefined();

    await saveUpload(storage, { body: 'x', originalName: 'a.txt', mimeType: 'text/plain' }, {
      key: 'two',
      metadata: { tenant: 'acme' },
    });
    expect(uploads[1]!.options.metadata).toEqual({
      originalname: 'a.txt',
      mimetype: 'text/plain',
      tenant: 'acme',
    });
  });

  it('forwards native options and abort signals', async () => {
    const { storage, uploads } = stubStorage();
    const controller = new AbortController();
    const native = { mode: 0o600 };
    await saveUpload(storage, { body: 'x' }, {
      key: 'private/key.txt',
      native: native as UploadOptions<'local'>['native'],
      signal: controller.signal,
    });
    expect(uploads[0]!.options.native).toEqual(native);
    expect(uploads[0]!.options.signal).toBe(controller.signal);
  });

  it('rejects a missing body', async () => {
    const { storage } = stubStorage();
    await expect(
      saveUpload(storage, { body: undefined as unknown as string }, { key: 'x' }),
    ).rejects.toThrow(TypeError);
  });
});

describe('saveWebFile', () => {
  it('stores a web File with its name, type and size', async () => {
    const { storage, uploads } = stubStorage();
    const file = new File([Buffer.from('web content')], 'hello.txt', { type: 'text/plain' });
    const saved = await saveWebFile(storage, file, { directory: 'web' });

    expect(saved.key).toMatch(/^web\/[0-9a-f-]{36}\.txt$/);
    expect(saved.originalName).toBe('hello.txt');
    expect(saved.mimeType).toBe('text/plain');
    const call = uploads[0]!;
    expect(call.body).toBe(file);
    expect(call.options.contentType).toBe('text/plain');
    // Blob body — size is not forced as contentLength.
    expect(call.options.contentLength).toBeUndefined();
  });

  it('handles nameless Blobs', async () => {
    const { storage } = stubStorage();
    const saved = await saveWebFile(storage, new Blob(['x'], { type: 'text/plain' }));
    expect(saved.originalName).toBeUndefined();
    expect(saved.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('exposes the full saved record for framework response bodies', async () => {
    const { storage } = stubStorage();
    const saved: SavedUpload = await saveWebFile(
      storage,
      new File(['x'], 'a.bin'),
    );
    expect(Object.keys(saved)).toContain('result');
  });
});
