import { describe, expect, it } from 'vitest';

import { defineDriverContractTests } from '../../src/testing/driver-contract';
import type { OracleStorage } from '../../src/drivers/oracle/index';

/**
 * OCI has no local emulator. Live tests are strictly opt-in:
 *   OCI_INTEGRATION_TESTS=true
 *   OCI_TEST_NAMESPACE / OCI_TEST_BUCKET / OCI_TEST_REGION
 * plus a configured authentication provider (config file, instance
 * principals, ...) resolvable by oci-common.
 */
const enabled = process.env.OCI_INTEGRATION_TESTS === 'true';

describe.skipIf(!enabled)('oracle live integration (opt-in)', () => {
  let storage: OracleStorage;

  defineDriverContractTests({
    name: 'oracle',
    createStorage: async () => {
      const { createOracleStorage } = await import('../../src/drivers/oracle/index.js');
      storage = await createOracleStorage({
        type: 'oracle',
        namespaceName: process.env.OCI_TEST_NAMESPACE!,
        bucketName: process.env.OCI_TEST_BUCKET!,
        region: process.env.OCI_TEST_REGION,
      });
      return storage;
    },
    capabilities: { signedUrls: false },
  });

  it('creates pre-authenticated requests through the oracle-specific API', async () => {
    const par = await storage.createPreauthenticatedRequest({
      objectName: 'par-check.txt',
      accessType: 'ObjectRead',
      timeExpires: new Date(Date.now() + 60 * 60 * 1000),
      name: `test-par-${Date.now()}`,
    });
    expect(par.accessUri).toBeTruthy();
    expect(par.id).toBeTruthy();
  });
});

describe.skipIf(enabled)('oracle live integration (gated)', () => {
  it('is skipped unless OCI_INTEGRATION_TESTS=true', () => {
    expect(true).toBe(true);
  });
});
