/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'tests/.*\\.spec\\.ts$',
  passWithNoTests: true,
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  // Cockatiel v4 is ESM-only. Mock the adapter untuk Jest CommonJS.
  // Path: dari apps/payment-api/ ke packages/resilience/__mocks__/
  moduleNameMapper: {
    'cockatiel-adapter': '<rootDir>/../../packages/resilience/__mocks__/cockatiel-adapter.ts',
  },
};
