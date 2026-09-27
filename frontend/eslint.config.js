// ESLint flat config — frontend (refs #386).
//
// See backend/eslint.config.js for why this did not exist. Same baseline, plus
// the React hooks rules the workspace already declares a dependency on but has
// never been able to run.

import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.js', '*.config.ts'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // Vite HMR: a module exporting more than components loses fast refresh.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // See backend config — TypeScript covers all three of these better.
      'no-undef': 'off',
      'no-unused-vars': 'off',

      // Declaration merging: MapContext.tsx declares `MapContextInternal` as
      // both a type and a value, which is legal and intentional.
      'no-redeclare': 'off',
    },
  },
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
];
