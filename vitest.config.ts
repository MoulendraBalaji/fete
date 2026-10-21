import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Two projects: pure domain/schema/route tests run in Node (fast), while
 * component tests run in jsdom with Testing Library.
 *
 * `esbuild.jsx` is set to the automatic runtime because the component tests
 * contain JSX; without it esbuild emits the classic `React.createElement` call
 * and the test file fails with "React is not defined".
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // `server-only` throws by design outside a React Server Component; tests
      // exercise those modules directly, so point it at an inert stub.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.node.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['tests/**/*.ui.test.tsx'],
          setupFiles: ['./tests/setup.ui.ts'],
        },
      },
    ],
  },
});
