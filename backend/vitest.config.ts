import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // The database-backed integration tests share one Postgres schema, so they
    // must not run concurrently with each other.
    fileParallelism: false,
  },
});
