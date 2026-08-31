import { beforeAll, describe, expect, it } from 'vitest';

import { defineDriverContractTests } from '../../src/testing/driver-contract';
import type { Storage } from '../../src/core/types';

/**
 * Azure contract tests run against Azurite or a real account. Enable by
 * exporting AZURE_TEST_CONNECTION_STRING (and AZURE_TEST_CONTAINER for
 * non-Azurite accounts):
 *   docker run -p 10000:10000 mcr.microsoft.com/azure-storage/azurite \
 *     azurite-blob --blobHost 127.0.0.1
 *   AZURE_TEST_CONNECTION_STRING='UseDevelopmentStorage=true'
 */
const enabled = Boolean(process.env.AZURE_TEST_CONNECTION_STRING);

describe.skipIf(!enabled)('azure integration', () => {
  let storage: Storage<'azure'>;

  const makeStorage = async () => {
    const { createAzureStorage } = await import('../../src/drivers/azure/index.js');
    return createAzureStorage({
      type: 'azure',
      container: process.env.AZURE_TEST_CONTAINER ?? 'test-container',
      connectionString: process.env.AZURE_TEST_CONNECTION_STRING,
    });
  };

  beforeAll(async () => {
    storage = await makeStorage();
    await storage
      .native()
      .createIfNotExists()
      .catch(() => undefined);
  });

  defineDriverContractTests({
    name: 'azure',
    createStorage: () => makeStorage(),
    capabilities: { signedUrls: true },
  });

  it('exposes the raw ContainerClient via native()', async () => {
    const client = storage.native();
    expect(typeof client.getBlobClient).toBe('function');
    expect(client.url).toContain(process.env.AZURE_TEST_CONTAINER ?? 'test-container');
  });

  it('generates SAS signed URLs', async () => {
    const url = await storage.getSignedUrl('sas-check.txt', { expiresIn: 120 });
    expect(url).toContain('sig=');
    expect(url).toContain('se=');
  });
});

describe.skipIf(enabled)('azure integration (gated)', () => {
  it('is skipped unless AZURE_TEST_CONNECTION_STRING is configured', () => {
    expect(true).toBe(true);
  });
});
