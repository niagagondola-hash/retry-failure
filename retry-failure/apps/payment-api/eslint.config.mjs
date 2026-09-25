/**
 * ESLint flat config for payment-api.
 *
 * tsconfigRootDir di-set eksplisit ke __dirname (folder package ini).
 * Wajib untuk monorepo: typescript-eslint butuh tahu tsconfig.json mana
 * yang dipakai untuk resolve types. Tanpa ini, parser complain
 * "multiple candidate TSConfigRootDirs are present".
 *
 * eslint.config.mjs di-ignore dari type-checking karena file config ini
 * sendiri tidak masuk di tsconfig.json include (file .mjs di root).
 */
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '*.config.{mjs,js,ts}',
      '**/*.config.{mjs,js,ts}',
    ],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: ['./tsconfig.json'],
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
