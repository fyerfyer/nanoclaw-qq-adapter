import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Installer tests spawn pnpm/tsx; a single fork avoids worker RPC timeouts.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'scripts/**/*.test.ts'],
    testTimeout: 10000,
  },
});
