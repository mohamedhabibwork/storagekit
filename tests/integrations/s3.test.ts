import { beforeAll, describe, expect, it } from 'vitest';

import { defineDriverContractTests } from '../../src/testing/driver-contract';
import type { Storage } from '../../src/core/types';

/**
 * S3 contract tests run against any S3-compatible endpoint (LocalStack, real
 * AWS, ...). Enable by exporting:
 *   S3_TEST_BUCKET=my-test-bucket
 *   S3_TEST_REGION=us-east-1
 *   S3_TEST_ENDPOINT=http://localhost:4566   (optional, e.g. LocalStack)
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
 */
const bucket = process.env.S3_TEST_BUCKET;
const enabled = Boolean(bucket);

describe.skipIf(!enabled)('s3 integration', () => {
  let storage: Storage<'s3'>;

  const makeStorage = async () => {
    const { createS3Storage } = await import('../../src/drivers/s3/index.js');
    return createS3Storage({
      type: 's3',
      bucket: bucket!,
      region: process.env.S3_TEST_REGION,
      endpoint: process.env.S3_TEST_ENDPOINT,
      forcePathStyle: Boolean(process.env.S3_TEST_ENDPOINT),
      credentials: process.env.AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
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
    name: 's3',
    createStorage: () => makeStorage(),
    capabilities: { signedUrls: true },
  });

  it('exposes the raw S3Client via native()', async () => {
    const { createS3Storage } = await import('../../src/drivers/s3/index.js');
    const s3 = await createS3Storage({
      type: 's3',
      bucket: bucket!,
      region: process.env.S3_TEST_REGION,
      endpoint: process.env.S3_TEST_ENDPOINT,
      forcePathStyle: Boolean(process.env.S3_TEST_ENDPOINT),
    });
    expect(s3.native().config).toBeDefined();
    expect(s3.capabilities().multipartUpload).toBe(true);
  });
});

describe.skipIf(enabled)('s3 integration (gated)', () => {
  it('is skipped unless S3_TEST_BUCKET is configured', () => {
    expect(true).toBe(true);
  });
});
