import { URL, fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@nodeslide/agent': fileURLToPath(new URL('./packages/agent/src/index.ts', import.meta.url)),
      '@nodeslide/backend': fileURLToPath(
        new URL('./packages/backend/src/index.ts', import.meta.url),
      ),
      '@nodeslide/cli': fileURLToPath(new URL('./packages/cli/src/index.ts', import.meta.url)),
      '@nodeslide/client-http': fileURLToPath(
        new URL('./packages/client-http/src/index.ts', import.meta.url),
      ),
      '@nodeslide/contracts': fileURLToPath(
        new URL('./packages/contracts/src/index.ts', import.meta.url),
      ),
      '@nodeslide/convex': fileURLToPath(
        new URL('./packages/convex/src/index.ts', import.meta.url),
      ),
      '@nodeslide/engine': fileURLToPath(
        new URL('./packages/engine/src/index.ts', import.meta.url),
      ),
      '@nodeslide/react': fileURLToPath(new URL('./packages/react/src/index.ts', import.meta.url)),
      '@nodeslide/react-headless': fileURLToPath(
        new URL('./packages/react-headless/src/index.ts', import.meta.url),
      ),
      '@nodeslide/registry': fileURLToPath(
        new URL('./packages/registry/src/index.ts', import.meta.url),
      ),
      '@nodeslide/testing': fileURLToPath(
        new URL('./packages/testing/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, '**/.claude/**', 'packages/external-agent/**', 'mcp/**'],
  },
  server: {
    port: 5180,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // Exact folder match only: substring 'react' would drag radix's
          // helper packages (react-remove-scroll, …) out of vendor and break
          // React's init order at runtime (useLayoutEffect undefined).
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('convex')) return 'convex';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('jszip')) return 'zip';
          return 'vendor';
        },
      },
    },
  },
});
