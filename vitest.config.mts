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
      // The CLI and the browser bundle shim are exercised through the build, not the unit tests.
      exclude: [ 'src/bin/**', 'src/browserNodeShims.ts' ],
      reporter: [ 'text', 'lcov' ],
      thresholds: {
        100: true,
      },
    },
  },
});
