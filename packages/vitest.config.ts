import { URL, fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageNames = [
  'agent',
  'backend',
  'client-http',
  'contracts',
  'convex',
  'engine',
  'react',
  'react-headless',
  'registry',
  'testing',
] as const;

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      packageNames.map((name) => [
        `@nodeslide/${name}`,
        fileURLToPath(new URL(`./${name}/src/index.ts`, import.meta.url)),
      ]),
    ),
  },
});
