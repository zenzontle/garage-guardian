import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import { fileURLToPath } from 'node:url';

const compat = new FlatCompat({
  baseDirectory: fileURLToPath(new URL('.', import.meta.url)),
  // Resolve Next.js-owned plugins from its package under pnpm's isolated layout.
  resolvePluginsRelativeTo: fileURLToPath(new URL('.', import.meta.resolve('eslint-config-next'))),
});

const config = [
  {
    ignores: ['.next/**', 'out/**', 'coverage/**', 'next-env.d.ts'],
  },
  js.configs.recommended,
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    files: ['*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  prettier,
];

export default config;
