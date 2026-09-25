/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'tests/.*\\.spec\\.ts$',
  passWithNoTests: true,
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
  moduleNameMapper: {
    // Cockatiel v4 is ESM-only -> mock via manual CJS mock
    'cockatiel-adapter': '<rootDir>/../../packages/resilience/__mocks__/cockatiel-adapter.ts',
    // @retry-failure/resilience -> resolve to source .ts (ts-jest transforms on-the-fly)
    '^@retry-failure/resilience$': '<rootDir>/../../packages/resilience/src/index.ts',
  },
};
