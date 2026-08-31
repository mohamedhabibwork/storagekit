import { defineConfig } from 'tsup';

const shared = {
  format: ['esm', 'cjs'] as const,
  target: 'es2022',
  dts: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  external: [
    /^@aws-sdk\//,
    /^@azure\//,
    /^minio($|\/)/,
    /^oci-(common|objectstorage)/,
  ],
};

export default defineConfig([
  {
    ...shared,
    clean: true,
    entry: {
      index: 'src/index.ts',
    },
  },
  {
    ...shared,
    entry: {
      'drivers/local/index': 'src/drivers/local/index.ts',
      'drivers/s3/index': 'src/drivers/s3/index.ts',
      'drivers/minio/index': 'src/drivers/minio/index.ts',
      'drivers/azure/index': 'src/drivers/azure/index.ts',
      'drivers/oracle/index': 'src/drivers/oracle/index.ts',
    },
  },
  {
    ...shared,
    entry: {
      'testing/driver-contract': 'src/testing/driver-contract.ts',
    },
    external: [...shared.external, 'vitest'],
  },
]);
