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
  // Mock cockatiel-adapter (which wraps ESM-only cockatiel v4) with manual CJS mock.
  // Tests import from '../src/policies/cockatiel-adapter' → jest maps to __mocks__.
  moduleNameMapper: {
    'cockatiel-adapter': '<rootDir>/__mocks__/cockatiel-adapter.ts',
  },
};
