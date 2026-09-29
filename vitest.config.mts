import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [ 'test/**/*.test.ts' ],
    globals: true,
    environment: 'node',
    coverage: {
      enabled: true,
      provider: 'v8',
      include: [ 'src/**/*.ts' ],
      // The browser bundle shim is exercised through the build, not the unit tests.
      exclude: [ 'src/browserNodeShims.ts' ],
      reporter: [ 'text', 'lcov' ],
      thresholds: {
        100: true,
      },
    },
  },
});
