const js = require('@eslint/js');
const google = require('eslint-config-google');
const globals = require('globals');
const babelParser = require('@babel/eslint-parser');

module.exports = [
  js.configs.recommended,
  google,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
      parser: babelParser,
      parserOptions: {
        sourceType: 'script',
        ecmaVersion: 2021,
      },
    },
    rules: {
      quotes: [
        'error',
        'single',
        {
          allowTemplateLiterals: true,
        },
      ],
      'prefer-arrow-callback': ['error'],
      'object-shorthand': ['error', 'always'],
      'quote-props': ['error', 'as-needed'],
      'object-curly-spacing': ['error', 'always'],
      'max-len': ['error',
        { code: 133,
          ignoreTrailingComments: true,
          ignoreComments: true,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
        }],
      'require-jsdoc': ['off'],
      'valid-jsdoc': ['off'],
      'no-array-constructor': ['off'],
      'no-caller': ['off'],
      'prefer-promise-reject-errors': ['off'],
      'guard-for-in': ['off'],
      'padded-blocks': ['off'],
      'new-cap': ['off'],
      camelcase: ['off'],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    ignores: ['trade/settings/', 'trade/tests/', 'trade/cs/test/', 'trade/cs/web_legacy/', '*.spec.js'],
  },
];
