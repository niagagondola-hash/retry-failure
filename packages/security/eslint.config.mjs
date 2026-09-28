/**
 * ESLint flat config for @retry-failure/security package (CODING_STANDARDS.md compliance).
 *
 * Categories applied (per docs/CODING_STANDARDS.md §Tooling):
 *   - Kategori 1 (Wajib): unused-imports, import order, no-console, no-debugger
 *   - Kategori 2 (Recommended): max-lines, max-lines-per-function, max-params, complexity
 *
 * tsconfigRootDir di-set eksplisit ke __dirname (folder package ini) supaya
 * typescript-eslint parser tahu tsconfig.json mana yang dipakai (penting di
 * monorepo untuk menghindari "multiple candidate TSConfigRootDirs").
 *
 * Plan reference: PLAN2 Section 9 (packages/security structure).
 */
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import importPlugin from 'eslint-plugin-import';
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
    plugins: {
      'unused-imports': unusedImports,
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: ['./tsconfig.json'],
      },
    },
    rules: {
      // ===== Kategori 1 (Wajib) =====

      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^_', args: 'all', argsIgnorePattern: '^_' },
      ],

      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc' },
        },
      ],
      'import/no-duplicates': 'error',

      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',

      // ===== Kategori 2 (Recommended — SOLID indicators) =====

      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'warn',
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
      'max-params': ['warn', { max: 4 }],
      complexity: ['warn', { max: 10 }],

      // ===== TypeScript-specific =====
      '@typescript-eslint/no-unused-vars': 'off', // handled by unused-imports
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Test files: jest mock factories use require() to grab the mocked module.
    // Test setup boilerplate is also inherently verbose (long `beforeEach`
    // blocks, many assertions, mock factory functions). Relax the structural
    // rules `max-lines-per-function`, `max-lines`, and `complexity` for tests
    // — same override pattern as `apps/auth-mock/eslint.config.mjs`.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      complexity: 'off',
    },
  },
);
