import { beforeAll, describe, expect, it } from 'vitest';

import { defineDriverContractTests } from '../../src/testing/driver-contract';
import type { Storage } from '../../src/core/types';

/**
 * Google Cloud Storage contract tests. Enable by exporting:
 *   GCS_TEST_BUCKET=my-test-bucket
 *   GCS_TEST_PROJECT_ID=my-project           (optional; falls back to ADC)
 *   GCS_TEST_ENDPOINT=http://localhost:9023 (optional; fake-gcs-server / emulator)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
 *
 * When `GCS_TEST_ENDPOINT` is set we send minimal fake credentials so the
 * SDK does not try to talk to the metadata server. In production, leave
 * `GCS_TEST_ENDPOINT` unset and rely on Application Default Credentials.
 */
const bucket = process.env.GCS_TEST_BUCKET;
const enabled = Boolean(bucket);

describe.skipIf(!enabled)('gcs integration', () => {
  let storage: Storage<'gcs'>;

  const makeStorage = async () => {
    const { createGcsStorage } = await import('../../src/drivers/gcs/index.js');
    const endpoint = process.env.GCS_TEST_ENDPOINT;
    return createGcsStorage({
      type: 'gcs',
      bucket: bucket!,
      projectId: process.env.GCS_TEST_PROJECT_ID ?? 'storagekit-e2e',
      ...(endpoint
        ? {
            apiEndpoint: endpoint,
            credentials: {
              client_email: 'fake@storagekit-e2e.iam.test',
              private_key:
                '-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDfake\n-----END PRIVATE KEY-----',
            },
          }
        : {}),
    });
  };

  beforeAll(async () => {
    storage = await makeStorage();
    try {
      await storage.native().bucket(bucket!).create();
    } catch {
      // already exists
    }
  });

  defineDriverContractTests({
    name: 'gcs',
    createStorage: () => makeStorage(),
    capabilities: { signedUrls: true, bulkDelete: false },
  });

  it('reports provider: gcs on upload/download results', async () => {
    const path = `provider-check-${Date.now()}.txt`;
    const uploaded = await storage.upload(path, Buffer.from('hello gcs'), {
      contentType: 'text/plain',
    });
    expect(uploaded.provider).toBe('gcs');
    const downloaded = await storage.download(path);
    expect(downloaded.provider).toBe('gcs');
    expect((await downloaded.text()).trim()).toBe('hello gcs');
    await storage.delete(path);
  });

  it('exposes the underlying Storage client via native()', async () => {
    const { createGcsStorage } = await import('../../src/drivers/gcs/index.js');
    const s = await createGcsStorage({
      type: 'gcs',
      bucket: bucket!,
      projectId: process.env.GCS_TEST_PROJECT_ID ?? 'storagekit-e2e',
    });
    expect(s.native().constructor.name).toBe('Storage');
    expect(s.capabilities().multipartUpload).toBe(true);
    expect(s.capabilities().signedUrls).toBe(true);
  });

  it('treats deleting a missing object as a no-op', async () => {
    await expect(storage.delete(`definitely-not-here-${Date.now()}.txt`)).resolves.toBeUndefined();
  });
});

describe.skipIf(enabled)('gcs integration (gated)', () => {
  it('is skipped unless GCS_TEST_BUCKET is configured', () => {
    expect(true).toBe(true);
  });
});
