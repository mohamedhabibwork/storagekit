import { beforeAll, describe, expect, it } from 'vitest';

import { defineDriverContractTests } from '../../src/testing/driver-contract';
import type { Storage } from '../../src/core/types';

/**
 * RustFS contract tests against a running RustFS server. Enable by exporting:
 *   RUSTFS_TEST_BUCKET=my-test-bucket
 *   RUSTFS_TEST_ENDPOINT=http://localhost:9000
 *   RUSTFS_TEST_ACCESS_KEY / RUSTFS_TEST_SECRET_KEY
 *   (default credentials are rustfsadmin / rustfsadmin — never use these
 *    outside a local trial)
 */
const bucket = process.env.RUSTFS_TEST_BUCKET;
const enabled = Boolean(bucket);

describe.skipIf(!enabled)('rustfs integration', () => {
  let storage: Storage<'rustfs'>;

  const makeStorage = async () => {
    const { createRustfsStorage } = await import('../../src/drivers/rustfs/index.js');
    return createRustfsStorage({
      type: 'rustfs',
      bucket: bucket!,
      endpoint: process.env.RUSTFS_TEST_ENDPOINT ?? 'http://localhost:9000',
      region: process.env.RUSTFS_TEST_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: process.env.RUSTFS_TEST_ACCESS_KEY
        ? {
            accessKeyId: process.env.RUSTFS_TEST_ACCESS_KEY,
            secretAccessKey: process.env.RUSTFS_TEST_SECRET_KEY ?? '',
          }
        : undefined,
    });
  };

  beforeAll(async () => {
    storage = await makeStorage();
    const { CreateBucketCommand } = await import('@aws-sdk/client-s3');
    await storage
      .native()
      .send(new CreateBucketCommand({ Bucket: bucket! }))
      .catch(() => undefined); // already exists
  });

  defineDriverContractTests({
    name: 'rustfs',
    createStorage: () => makeStorage(),
    capabilities: { signedUrls: true },
  });

  it('reports provider: rustfs on upload/download results', async () => {
    const path = `provider-check-${Date.now()}.txt`;
    const uploaded = await storage.upload(path, Buffer.from('hello rustfs'), {
      contentType: 'text/plain',
    });
    expect(uploaded.provider).toBe('rustfs');
    const downloaded = await storage.download(path);
    expect(downloaded.provider).toBe('rustfs');
    expect((await downloaded.text()).trim()).toBe('hello rustfs');
    await storage.delete(path);
  });

  it('exposes the underlying S3Client via native()', async () => {
    const { createRustfsStorage } = await import('../../src/drivers/rustfs/index.js');
    const s = await createRustfsStorage({
      type: 'rustfs',
      bucket: bucket!,
      endpoint: process.env.RUSTFS_TEST_ENDPOINT ?? 'http://localhost:9000',
    });
    expect(s.native().config).toBeDefined();
    expect(s.capabilities().multipartUpload).toBe(true);
  });

  it('applies RustFS defaults (region us-east-1, forcePathStyle true)', async () => {
    const { createRustfsStorage } = await import('../../src/drivers/rustfs/index.js');
    const s = await createRustfsStorage({
      type: 'rustfs',
      bucket: bucket!,
      endpoint: process.env.RUSTFS_TEST_ENDPOINT ?? 'http://localhost:9000',
    });
    const client = s.native();
    expect(client.config.region).toBe('us-east-1');
    expect(client.config.forcePathStyle).toBe(true);
  });
});

describe.skipIf(enabled)('rustfs integration (gated)', () => {
  it('is skipped unless RUSTFS_TEST_BUCKET is configured', () => {
    expect(true).toBe(true);
  });
});
