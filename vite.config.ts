import { URL, fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, '**/.claude/**'],
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
