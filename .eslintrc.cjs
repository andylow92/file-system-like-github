module.exports = {
  root: true,
  env: {
    es2023: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  ignorePatterns: ['dist', 'node_modules'],
  overrides: [
    {
      files: ['apps/api/**/*.ts'],
      env: {
        node: true,
      },
    },
    {
      files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
      env: {
        browser: true,
      },
      extends: ['plugin:react-hooks/recommended'],
      rules: {
        'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx'],
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
  ],
};
