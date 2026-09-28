/**
 * ESLint flat config for auth-mock (CODING_STANDARDS.md compliance).
 *
 * Categories applied (per docs/CODING_STANDARDS.md §Tooling):
 *   - Kategori 1 (Wajib): unused-imports, import order, no-console, no-debugger
 *   - Kategori 2 (Recommended): max-lines, max-lines-per-function, max-params, complexity
 *
 * tsconfigRootDir di-set eksplisit ke __dirname (folder package ini).
 * Wajib untuk monorepo: typescript-eslint butuh tahu tsconfig.json mana
 * yang dipakai untuk resolve types.
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

      // Auto-remove unused imports + warn unused vars
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^_', args: 'all', argsIgnorePattern: '^_' },
      ],

      // Import order consistency (builtin → external → internal → parent → sibling)
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc' },
        },
      ],
      'import/no-duplicates': 'error',

      // No console.log (use NestJS Logger instead)
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // No debugger statements
      'no-debugger': 'error',

      // ===== Kategori 2 (Recommended — SOLID indicators) =====

      // SRP: max file length (warn di 300 lines)
      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],

      // SRP: max function length (warn di 50 lines)
      'max-lines-per-function': [
        'warn',
        { max: 50, skipBlankLines: true, skipComments: true },
      ],

      // ISP: max params (warn di 4)
      'max-params': ['warn', { max: 4 }],

      // Cyclomatic complexity (warn di 10)
      complexity: ['warn', { max: 10 }],

      // ===== TypeScript-specific =====
      '@typescript-eslint/no-unused-vars': 'off', // handled by unused-imports
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Test files: spec / e2e-spec setup boilerplate is inherently verbose
    // (long `beforeEach` blocks, many assertions, mock factory functions).
    // The structural rules `max-lines-per-function`, `max-lines`, and
    // `complexity` flag legitimate test patterns. Relax them for tests —
    // mirrors the override already in `packages/security/eslint.config.mjs`.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      complexity: 'off',
      // Test factories sometimes need `require()` for jest.mock hoisting.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
