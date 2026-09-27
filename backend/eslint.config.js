// ESLint flat config — backend (refs #386).
//
// `npm run lint` has never actually run in this repo. ESLint 9 requires flat
// config and no config file existed anywhere, so both workspaces exited 2 with
// "ESLint couldn't find an eslint.config.(js|mjs|cjs) file" and the root
// `npm run lint --workspaces` failed. A lint step that has never executed is
// worse than no lint step: it reads as coverage that does not exist.
//
// This is a deliberately plain baseline — the recommended sets, nothing
// weakened — so the first run reports what is actually there rather than a
// number massaged to look tidy.

import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.js'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // TypeScript already reports undefined identifiers, and no-undef does not
      // understand type-only names. Leaving it on produces false positives on
      // every interface reference.
      'no-undef': 'off',

      // The TS-aware version understands parameter properties, overloads and
      // type-only imports; the base rule does not.
      'no-unused-vars': 'off',

      // TypeScript's declaration merging deliberately declares a type and a
      // value under one name -- see Result.ts, where `Result` is both. The base
      // rule reads that as a redeclaration; tsc, which actually understands it,
      // reports a genuine redeclaration itself.
      'no-redeclare': 'off',
    },
  },
  {
    // Tests legitimately use fixtures and partial mocks that look unused.
    files: ['**/__tests__/**/*.ts', '**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // This suite exists to assert what happens to coordinates BEYOND double
    // precision. Its literals lose precision on purpose -- that is the thing
    // under test, and the rule firing here is the finding being wrong rather
    // than the code. Scoped to this one file, deliberately: elsewhere a literal
    // silently losing precision is exactly what we want to hear about.
    files: ['**/__tests__/coordinatePrecision.test.ts'],
    rules: {
      'no-loss-of-precision': 'off',
    },
  },
];
