/**
 * ESLint flat config for @retry-failure/security package.
 *
 * tsconfigRootDir di-set eksplisit ke __dirname (folder package ini) supaya
 * typescript-eslint parser tahu tsconfig.json mana yang dipakai (penting di
 * monorepo untuk menghindari "multiple candidate TSConfigRootDirs").
 *
 * Plan reference: PLAN2 Section 9 (packages/security structure).
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
      'coverage/**',
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
  {
    // Test files: jest mock factories use require() to grab the mocked module.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
