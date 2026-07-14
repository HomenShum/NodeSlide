import { defineConfig } from 'vitest/config';

// Local config so vitest run inside mcp/ does NOT walk up to the app's root
// vite.config.ts (which pulls in @vitejs/plugin-react, not an mcp dependency).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
