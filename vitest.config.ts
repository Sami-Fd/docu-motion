import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          setupFiles: ['packages/core/test/setup/node20-iterator.ts'],
          include: ['packages/*/test/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'packages/core/test/render/**'],
        },
      },
      {
        test: {
          name: 'visual',
          testTimeout: 60_000,
          hookTimeout: 60_000,
          setupFiles: ['packages/core/test/setup/node20-iterator.ts'],
          include: ['packages/core/test/render/**/*.test.ts'],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
  },
});
