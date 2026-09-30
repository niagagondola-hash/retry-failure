/**
 * Jest config for the AUTH-26 E2E suite (`auth-mock.e2e.spec.ts`).
 *
 * Plan reference: PLAN2 Section 17.3 (E2E lintas service), AUTH-26 task spec
 * §5 (jest.e2e.config.js).
 *
 * Why a separate config:
 *   The existing `tests/e2e/jest-e2e.json` config matches ALL `*.e2e-spec.ts`
 *   files under `tests/e2e/` — including the Plan1 payments e2e specs that
 *   require PostgreSQL + gateway-mock running. AUTH-26 needs to run the
 *   auth-mock e2e specs WITHOUT requiring postgres/gateway (only auth-mock
 *   + payment-api). This config narrows `testMatch` to auth-mock specs only
 *   so `pnpm test:e2e` runs the right subset.
 *
 * Test timeout:
 *   30s per test (vs 180s for payments e2e) — OAuth flow is ~5 HTTP
 *   round-trips on localhost, takes <2s. 30s gives plenty of headroom for
 *   CI / slow machines.
 *
 * ts-jest config:
 *   Mirrors `jest.config.js` (root) so the same TS features
 *   (experimentalDecorators, ES2022 target, isolatedModules) work.
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  // Only match `auth-mock*.e2e.spec.ts` (NOT the Plan1 payments e2e specs
  // — those need PostgreSQL + gateway-mock + use `tests/e2e/jest-e2e.json`).
  testMatch: ['**/tests/e2e/auth-mock*.e2e.spec.ts'],
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
        },
        isolatedModules: true,
      },
    ],
  },
  // Run tests serially — OAuth flow reuses fixture users + auth-mock session
  // state can leak between parallel runs (single auth_sid cookie per user).
  maxWorkers: 1,
  // 30s per test — real HTTP + multi-step OAuth flow (~5 round-trips).
  testTimeout: 30_000,
  // Don't collect coverage (E2E tests aren't part of the coverage threshold).
  collectCoverage: false,
  // Transform ESM-only deps via ts-jest/babel so Jest's CommonJS runtime
  // can `require()` them. `axios-cookiejar-support@7` ships ESM (`import`)
  // which Jest can't consume untransformed in CommonJS test environment.
  // The pattern says: don't ignore anything in node_modules EXCEPT these
  // explicitly-listed ESM packages (transform them via ts-jest).
  transformIgnorePatterns: [
    'node_modules/(?!axios-cookiejar-support|http-cookie-agent)',
  ],
  verbose: true,
};
