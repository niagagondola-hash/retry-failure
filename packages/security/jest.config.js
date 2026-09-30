/**
 * Jest config for @retry-failure/security.
 *
 * Plan reference: PLAN2 Section 17.1 (unit tests, coverage threshold ≥90% lines
 * / ≥80% branches).
 *
 * Coverage threshold: global ≥90% lines/functions/statements, ≥80% branches.
 * If a future change drops below threshold, ADD tests — do NOT lower the bar.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'tests/.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  passWithNoTests: true,
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
