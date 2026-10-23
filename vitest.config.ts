import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'packages/core/test/render/**'],
        },
      },
      {
        test: {
          name: 'visual',
          include: ['packages/core/test/render/**/*.test.ts'],
          exclude: ['**/node_modules/**'],
          passWithNoTests: true,
        },
      },
    ],
  },
});
