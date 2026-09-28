const config = require('@rubensworks/eslint-config');

module.exports = config([
  {
    ignores: [ 'dist/**', 'coverage/**', 'perf/**', 'scripts/**', 'spec/**', '.rdf-test-suite-cache/**', '**/*.md' ],
  },
  {
    files: [ '**/*.ts', '**/*.mts' ],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: [ './tsconfig.json' ],
      },
    },
  },
  {
    rules: {
      // The parser deliberately scans UTF-16 code units with charCodeAt in its hot loops;
      // codePointAt has different semantics for surrogate pairs and is slower.
      'unicorn/prefer-code-point': 'off',
      // Would require renaming the public interfaces (IParserOptions, ...) and flags the
      // underscored methods (_transform, _flush) that the stream API requires.
      'ts/naming-convention': 'off',
    },
  },
  {
    // Only the CLI and the tests are Node.js-specific.
    files: [ 'src/bin/**/*.ts', 'test/**/*.ts' ],
    rules: {
      'import/no-nodejs-modules': 'off',
    },
  },
  {
    // The tests use vitest, whose API mirrors jest; the jest rules need a version hint.
    files: [ 'test/**/*.ts' ],
    settings: { jest: { version: 29 }},
  },
]);
