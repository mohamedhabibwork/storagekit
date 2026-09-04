import { defineConfig } from 'tsup';

const shared = {
  format: ['esm', 'cjs'] as const,
  target: 'es2022',
  // Declarations are emitted by `tsc -p tsconfig.build.json` (build script)
  // instead of rollup-plugin-dts, whose tsup-embedded copy crashes under
  // TypeScript 7 (ts.sys is no longer exposed).
  dts: false,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  external: [
    /^@aws-sdk\//,
    /^@azure\//,
    /^@google-cloud\//,
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
      'drivers/rustfs/index': 'src/drivers/rustfs/index.ts',
      'drivers/gcs/index': 'src/drivers/gcs/index.ts',
      // Upload intake: framework-agnostic core + framework adapters.
      // Adapters never import their framework (structural types only), so
      // nothing extra needs to be external.
      'uploads/index': 'src/uploads/index.ts',
      'adapters/express': 'src/adapters/express.ts',
      'adapters/fastify': 'src/adapters/fastify.ts',
      'adapters/formidable': 'src/adapters/formidable.ts',
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
