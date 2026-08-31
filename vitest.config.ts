import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    typecheck: {
      include: ['types/**/*.test-d.ts'],
      tsconfig: 'tsconfig.typecheck.json',
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
