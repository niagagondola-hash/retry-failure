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
};
