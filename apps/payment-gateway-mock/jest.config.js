/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '.spec.ts$',
  passWithNoTests: true,
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
};
