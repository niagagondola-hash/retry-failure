/**
 * Jest config for contract tests (AUTH-27).
 *
 * Plan reference: PLAN2 Section 17.5, AUTH-27 task spec §5.5.
 *
 * Separate config supaya contract tests tidak ikut run di `pnpm test`
 * (which runs unit tests). Contract tests butuh auth service running
 * (port 4001 by default) — bukan dev dependency.
 *
 * Usage:
 *   pnpm --filter payment-api test:contract
 *
 * Coding standards: file .js (CommonJS) di-ignore dari type-checking
 * per `eslint.config.mjs` ignores pattern `*.config.{mjs,js,ts}`.
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'tests/contract/.*\\.contract\\.spec\\.ts$',
  passWithNoTests: false,
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          module: 'commonjs',
          target: 'ES2022',
          esModuleInterop: true,
          skipLibCheck: true,
          strict: false,
          isolatedModules: true,
        },
      },
    ],
  },
  testTimeout: 30000,
  verbose: true,
};
