import { beforeAll, describe, expect, it } from 'vitest';

import { defineDriverContractTests } from '../../src/testing/driver-contract';
import type { Storage } from '../../src/core/types';

/**
 * MinIO contract tests run against a real MinIO server (e.g. the Docker
 * image `minio/minio`). Enable by exporting:
 *   MINIO_TEST_ENDPOINT=localhost
 *   MINIO_TEST_PORT=9000
 *   MINIO_TEST_ACCESS_KEY=minioadmin
 *   MINIO_TEST_SECRET_KEY=minioadmin
 *   MINIO_TEST_BUCKET=test-bucket
 */
const enabled = Boolean(process.env.MINIO_TEST_ENDPOINT && process.env.MINIO_TEST_BUCKET);

describe.skipIf(!enabled)('minio integration', () => {
  let storage: Storage<'minio'>;

  const makeStorage = async () => {
    const { createMinioStorage } = await import('../../src/drivers/minio/index.js');
    return createMinioStorage({
      type: 'minio',
      bucket: process.env.MINIO_TEST_BUCKET!,
      endPoint: process.env.MINIO_TEST_ENDPOINT!,
      port: process.env.MINIO_TEST_PORT ? Number(process.env.MINIO_TEST_PORT) : undefined,
      useSSL: process.env.MINIO_TEST_USE_SSL === 'true',
      accessKey: process.env.MINIO_TEST_ACCESS_KEY,
      secretKey: process.env.MINIO_TEST_SECRET_KEY,
    });
  };

  beforeAll(async () => {
    storage = await makeStorage();
    await storage
      .native()
      .makeBucket(process.env.MINIO_TEST_BUCKET!, 'us-east-1')
      .catch(() => undefined); // already exists
  });

  defineDriverContractTests({
    name: 'minio',
    createStorage: () => makeStorage(),
    capabilities: { signedUrls: true },
  });

  it('exposes the raw MinIO Client via native()', async () => {
    const client = storage.native();
    expect(typeof client.putObject).toBe('function');
    expect(typeof client.presignedGetObject).toBe('function');
  });
});

describe.skipIf(enabled)('minio integration (gated)', () => {
  it('is skipped unless MINIO_TEST_* variables are configured', () => {
    expect(true).toBe(true);
  });
});
