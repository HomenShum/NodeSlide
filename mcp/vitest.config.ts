import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Local config so vitest run inside mcp/ does NOT walk up to the app's root
// vite.config.ts (which pulls in @vitejs/plugin-react, not an mcp dependency).
export default defineConfig({
  resolve: {
    alias: {
      '@nodeslide/external-agent': fileURLToPath(
        new URL('../packages/external-agent/src/index.ts', import.meta.url),
      ),
      '@nodeslide/backend': fileURLToPath(
        new URL('../packages/backend/src/index.ts', import.meta.url),
      ),
      '@nodeslide/contracts': fileURLToPath(
        new URL('../packages/contracts/src/index.ts', import.meta.url),
      ),
      '@nodeslide/engine': fileURLToPath(
        new URL('../packages/engine/src/index.ts', import.meta.url),
      ),
      '@nodeslide/testing': fileURLToPath(
        new URL('../packages/testing/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
