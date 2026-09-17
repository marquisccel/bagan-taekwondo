import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Determinism rules for pure packages (ADR-0006): the engine and its dependencies must never
 * read the clock, ambient randomness, or locale-dependent ordering.
 */
const PURE_PACKAGES = [
  'packages/shared/src/**/*.ts',
  'packages/domain/src/**/*.ts',
  'packages/rules/src/**/*.ts',
  'packages/draw-engine/src/**/*.ts',
  'packages/intake/src/**/*.ts',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'data/**',
      'out/**',
      '**/*.js',
      '**/*.cjs',
      '**/next-env.d.ts',
      'apps/web/e2e/**',
      'apps/web/playwright.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        project: ['./tsconfig.lint.json', './apps/api/tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        project: ['./apps/web/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // JSX event handlers commonly close over an inline object literal / arrow function; the
      // repo-wide restriction exists for the pure-package determinism rules, not the UI.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      // `onClick={() => setFoo(x)}` is the idiomatic React callback shape everywhere in this app;
      // requiring braces around every one-line state setter fights the framework, not a real bug.
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
  {
    files: PURE_PACKAGES,
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded Prng from @bagantkd/shared (ADR-0006).',
        },
        { object: 'Date', property: 'now', message: 'Pure packages must not read the clock (ADR-0006).' },
        { object: 'crypto', property: 'randomUUID', message: 'Use deterministicUuid (ADR-0006).' },
        {
          property: 'localeCompare',
          message: 'Use compareStrings: locale-independent total order (ADR-0006).',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Pure packages must not read the clock (ADR-0006).',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'performance', message: 'Pure packages must not read the clock (ADR-0006).' },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
