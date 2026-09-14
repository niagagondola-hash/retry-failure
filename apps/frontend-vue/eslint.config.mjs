import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import tsParser from '@typescript-eslint/parser';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    // 1. Target Ignore Global
    ignores: [
      'dist/**',
      'node_modules/**',
      '*.config.{mjs,js,ts}',
      '**/*.config.{mjs,js,ts}',
    ],
  },
  // 2. Load Rekomendasi Rules
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  
  // 3. Konfigurasi Khusus File TS dan VUE (Agar type-checking monorepo berjalan)
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.vue'],
    languageOptions: {
      parser: vueParser, // Wajib vue-eslint-parser di tingkat atas untuk file .vue
      parserOptions: {
        parser: tsParser, // Gunakan tsParser untuk blok <script lang="ts"> dan file .ts
        sourceType: 'module',
        tsconfigRootDir: __dirname,
        project: ['./tsconfig.json'],
        extraFileExtensions: ['.vue'],
      },
    },
  },
  
  // 4. Kustomisasi Rules Anda
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.vue'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // Anda bisa menambahkan rules auto-fix vue di sini jika diperlukan, contoh:
      'vue/html-indent': ['error', 2], 
    },
  },
);
