import { FlatCompat } from '@eslint/eslintrc';
import prettier from 'eslint-config-prettier';

/**
 * Flat config that composes Next.js' legacy-format presets (core-web-vitals +
 * typescript) with project rules. Prettier must come last so it can disable
 * any stylistic rules that would fight the formatter.
 */
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // The brief is explicit: no `any` anywhere in this codebase.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Privacy: only warn/error codes may reach the logs — never plan contents.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      // Test assertions intentionally reach into loosely-typed fixtures.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
];

export default config;
