import love from 'eslint-config-love'
import stylistic from '@stylistic/eslint-plugin'

const tsFiles = ['**/*.ts']

export default [
  // FORMATTING RULES
  {
    ...stylistic.configs.recommended,
    files: tsFiles
  },
  {
    files: tsFiles,
    rules: {
      '@stylistic/arrow-parens': ['error', 'as-needed'],
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      '@stylistic/comma-dangle': ['error', 'never'],
      '@stylistic/indent': ['error', 2, { ignoreComments: true }],
      '@stylistic/max-statements-per-line': ['error', { max: 3 }],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/quote-props': ['error', 'as-needed'],
      '@stylistic/space-before-function-paren': ['error', 'always'],
      '@stylistic/type-annotation-spacing': 'error',
      '@stylistic/type-generic-spacing': 'error'
    }
  },
  // STRUCTURAL RULES
  {
    ...love,
    files: tsFiles
  },
  {
    files: tsFiles,
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.eslint.json'
      }
    },
    rules: {
      '@typescript-eslint/array-type': ['error', { default: 'array' }],
      '@typescript-eslint/class-methods-use-this': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/init-declarations': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/no-misused-spread': 'off',
      '@typescript-eslint/max-params': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/prefer-destructuring': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignoreConditionalTests: true, ignorePrimitives: { bigint: false, boolean: false, number: false, string: true } }],
      '@typescript-eslint/prefer-readonly': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowAny: true }],
      '@typescript-eslint/strict-boolean-expressions': 'off',
      complexity: 'off',
      'max-lines': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'max-depth': 'off',
      'no-await-in-loop': 'off',
      'no-negated-condition': 'off',
      'no-param-reassign': 'off',
      'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],
      'prefer-named-capture-group': 'off',
      'prefer-template': 'off',
      'promise/avoid-new': 'off',
      'require-atomic-updates': 'off'
    }
  },
  // RELAXED RULES FOR TEST FILES
  {
    files: ['test/**/*.ts', 'test*service/**/*.ts', 'testgatewayapollo/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off'
    }
  }
]
