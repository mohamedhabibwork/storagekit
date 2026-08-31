import { Readable } from 'node:stream';

import { describe, expect, it, beforeEach } from 'vitest';

import { createStorage } from '../../src/factory';
import { StorageNotFoundError } from '../../src/core/errors';
import type { Storage } from '../../src/core/types';

type RequestRecord = Record<string, any>;

/**
 * A scripted stand-in for ObjectStorageClient. Records every request so the
 * mocked suite can assert exactly what the driver sends to OCI — no network,
 * no emulator (OCI has none).
 */
class FakeObjectStorageClient {
  requests: Array<{ method: string; body: RequestRecord }> = [];
  private notFoundOnHead = new Set<string>();

  private record(method: string, body: RequestRecord): void {
    this.requests.push({ method, body });
  }

  failHeadFor(objectName: string): void {
    this.notFoundOnHead.add(objectName);
  }

  async putObject(request: RequestRecord) {
    this.record('putObject', request);
    return { eTag: 'etag-put', opcContentMd5: 'md5', opcRequestId: 'r1' };
  }

  async getObject(request: RequestRecord) {
    this.record('getObject', request);
    return {
      value: Readable.from([Buffer.from('oci body')]),
      eTag: 'etag-get',
      contentType: 'text/plain',
      contentLength: 8,
      lastModified: new Date('2026-01-01T00:00:00Z'),
      opcMeta: { userid: '7' },
      opcRequestId: 'r2',
    };
  }

  async headObject(request: RequestRecord) {
    this.record('headObject', request);
    if (this.notFoundOnHead.has(request.objectName)) {
      throw Object.assign(new Error('NotExistsOrUnauthorized'), { statusCode: 404 });
    }
    return {
      eTag: 'etag-head',
      contentLength: 8,
      contentType: 'text/plain',
      lastModified: new Date('2026-01-01T00:00:00Z'),
      opcMeta: { userid: '7' },
      opcRequestId: 'r3',
    };
  }

  async deleteObject(request: RequestRecord) {
    this.record('deleteObject', request);
    return { opcRequestId: 'r4', isNotModified: false };
  }

  async listObjects(request: RequestRecord) {
    this.record('listObjects', request);
    return {
      listObjects: {
        objects: [
          { name: `${request.prefix ?? ''}a.txt`, size: 1, etag: 'e1', timeModified: new Date() },
          { name: `${request.prefix ?? ''}b.txt`, size: 2, etag: 'e2', timeModified: new Date() },
        ],
        prefixes: request.delimiter ? [`${request.prefix ?? ''}sub/`] : [],
        nextStartWith: request.limit === 1 ? `${request.prefix ?? ''}a.txt` : undefined,
      },
      opcRequestId: 'r5',
    };
  }

  async copyObject(request: RequestRecord) {
    this.record('copyObject', request);
    return { opcWorkRequestId: 'wr-1', opcRequestId: 'r6' };
  }

  async createMultipartUpload(request: RequestRecord) {
    this.record('createMultipartUpload', request);
    return { multipartUpload: { uploadId: 'upload-1' }, opcRequestId: 'r7' };
  }

  async uploadPart(request: RequestRecord) {
    this.record('uploadPart', request);
    return { eTag: `part-etag-${request.uploadPartNum}`, opcRequestId: 'r8' };
  }

  async commitMultipartUpload(request: RequestRecord) {
    this.record('commitMultipartUpload', request);
    return { eTag: 'commit-etag', opcRequestId: 'r9' };
  }

  async abortMultipartUpload(request: RequestRecord) {
    this.record('abortMultipartUpload', request);
    return { opcRequestId: 'r10' };
  }

  methodCalls(method: string): Array<RequestRecord> {
    return this.requests.filter((entry) => entry.method === method).map((entry) => entry.body);
  }
}

describe('oracle driver (mocked OCI client)', () => {
  let fake: FakeObjectStorageClient;
  let storage: Storage<'oracle'>;

  const config = {
    type: 'oracle' as const,
    namespaceName: 'mynamespace',
    bucketName: 'mybucket',
    region: 'eu-frankfurt-1',
  };

  beforeEach(() => {
    fake = new FakeObjectStorageClient();
  });

  async function makeStorage(prefix?: string): Promise<Storage<'oracle'>> {
    return createStorage({
      ...config,
      ...(prefix !== undefined ? { prefix } : {}),
      client: fake as never,
    });
  }

  it('uploads buffers with detected content type and normalized fields', async () => {
    storage = await makeStorage();
    const result = await storage.upload('users/1/photo.jpg', Buffer.from('jpeg-bytes'));

    const put = fake.methodCalls('putObject')[0];
    expect(put.namespaceName).toBe('mynamespace');
    expect(put.bucketName).toBe('mybucket');
    expect(put.objectName).toBe('users/1/photo.jpg');
    expect(put.contentType).toBe('image/jpeg');
    expect(put.contentLength).toBe(10);
    expect(result.etag).toBe('etag-put');
    expect(result.url).toBe(
      'https://objectstorage.eu-frankfurt-1.oraclecloud.com/n/mynamespace/b/mybucket/o/users/1/photo.jpg',
    );
  });

  it('maps common metadata onto opcMeta', async () => {
    storage = await makeStorage();
    await storage.upload('meta.txt', 'x', { metadata: { owner: '42' }, contentType: 'text/plain' });
    const put = fake.methodCalls('putObject')[0];
    expect(put.opcMeta).toEqual({ owner: '42' });
  });

  it('uses multipart upload machinery for streams', async () => {
    storage = await makeStorage();
    const stream = Readable.from([Buffer.alloc(1024 * 1024, 1), Buffer.alloc(512 * 1024, 2)]);
    const result = await storage.upload('videos/blob.bin', stream, {
      multipart: { partSize: 1024 * 1024, concurrency: 2 },
      contentType: 'application/octet-stream',
    });

    expect(result.etag).toBe('commit-etag');
    const creates = fake.methodCalls('createMultipartUpload');
    expect(creates).toHaveLength(1);
    expect(creates[0].createMultipartUploadDetails.object).toBe('videos/blob.bin');
    const parts = fake.methodCalls('uploadPart');
    expect(parts.map((p) => p.uploadPartNum)).toEqual([1, 2]);
    const commit = fake.methodCalls('commitMultipartUpload')[0];
    expect(commit.uploadId).toBe('upload-1');
    expect(commit.commitMultipartUploadDetails.partsToCommit).toEqual([
      { partNum: 1, etag: 'part-etag-1' },
      { partNum: 2, etag: 'part-etag-2' },
    ]);
  });

  it('downloads through response.value and normalizes opcMeta', async () => {
    storage = await makeStorage();
    const download = await storage.download('docs/file.txt', { versionId: 'v-1' });
    expect((await download.buffer()).toString('utf8')).toBe('oci body');
    expect(download.etag).toBe('etag-get');
    expect(download.metadata).toEqual({ userid: '7' });

    const get = fake.methodCalls('getObject')[0];
    expect(get.versionId).toBe('v-1');
  });

  it('supports range downloads via native OCI ranges', async () => {
    storage = await makeStorage();
    await storage.download('docs/file.txt', { range: { offset: 10, length: 20 } });
    const get = fake.methodCalls('getObject')[0];
    expect(get.range).toBeDefined();
  });

  it('throws normalized not-found errors from head', async () => {
    storage = await makeStorage();
    fake.failHeadFor('missing.txt');
    await expect(storage.stat('missing.txt')).rejects.toBeInstanceOf(StorageNotFoundError);
    await expect(storage.exists('missing.txt')).resolves.toBe(false);
    await expect(storage.exists('present.txt')).resolves.toBe(true);
  });

  it('lists with prefix and delimiter mapping and cursor passthrough', async () => {
    storage = await makeStorage();
    const page = await storage.list({ prefix: 'media/', limit: 1 });
    const list = fake.methodCalls('listObjects')[0];
    expect(list.prefix).toBe('media/');
    expect(list.limit).toBe(1);
    expect(list.delimiter).toBe('/');
    expect(list.fields).toBe('name,size,etag,timeModified');
    expect(page.files.map((f) => f.path)).toEqual(['media/a.txt', 'media/b.txt']);
    expect(page.directories).toEqual(['media/sub/']);
    expect(page.cursor).toBe('media/a.txt');
    expect(page.hasMore).toBe(true);

    await storage.list({ recursive: true });
    expect(fake.methodCalls('listObjects')[1].delimiter).toBeUndefined();
  });

  it('copies server-side with required destination region', async () => {
    storage = await makeStorage();
    await storage.copy('a.txt', 'b.txt');
    const copy = fake.methodCalls('copyObject')[0];
    expect(copy.copyObjectDetails.sourceObjectName).toBe('a.txt');
    expect(copy.copyObjectDetails.destinationObjectName).toBe('b.txt');
    expect(copy.copyObjectDetails.destinationBucket).toBe('mybucket');
    expect(copy.copyObjectDetails.destinationRegion).toBe('eu-frankfurt-1');
    expect(copy.copyObjectDetails.destinationNamespace).toBe('mynamespace');
  });

  it('moves = copy + delete', async () => {
    storage = await makeStorage();
    await storage.move('old.txt', 'new.txt');
    expect(fake.methodCalls('copyObject')).toHaveLength(1);
    const deletes = fake.methodCalls('deleteObject');
    expect(deletes[0].objectName).toBe('old.txt');
  });

  it('applies the configured prefix to every operation', async () => {
    storage = await makeStorage('tenant-7');
    await storage.upload('file.txt', 'x');
    expect(fake.methodCalls('putObject')[0].objectName).toBe('tenant-7/file.txt');

    await storage.download('file.txt');
    expect(fake.methodCalls('getObject')[0].objectName).toBe('tenant-7/file.txt');

    const page = await storage.list({ prefix: 'docs/' });
    expect(fake.methodCalls('listObjects')[0].prefix).toBe('tenant-7/docs/');
    expect(page.files.map((f) => f.path)).toEqual(['docs/a.txt', 'docs/b.txt']);

    const url = await storage.getUrl('file.txt');
    expect(url).toContain('/o/tenant-7/file.txt');
  });

  it('throws unsupported for presigned URLs (use PARs instead)', async () => {
    storage = await makeStorage();
    await expect(storage.getSignedUrl('x.txt')).rejects.toThrow(/pre-authenticated/i);
  });
});
