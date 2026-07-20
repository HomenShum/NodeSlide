import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@nodeslide/backend': fileURLToPath(new URL('../backend/src/index.ts', import.meta.url)),
      '@nodeslide/contracts': fileURLToPath(new URL('../contracts/src/index.ts', import.meta.url)),
      '@nodeslide/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      '@nodeslide/testing': fileURLToPath(new URL('../testing/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
