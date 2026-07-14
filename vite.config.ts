import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
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
          if (id.includes('react') || id.includes('react-dom')) return 'react';
          if (id.includes('convex')) return 'convex';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('jszip')) return 'zip';
          return 'vendor';
        },
      },
    },
  },
});
