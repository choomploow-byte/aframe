import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Names that must never appear in src/core (pure TS shared by the app and the MCP bundle).
// tsconfig.core.json enforces the same rule at compile time; this gives a clearer message.
const forbiddenCoreGlobals = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'process',
  'Buffer',
  'require',
];

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-perf',
      'tests/e2e/__diff__',
      'coverage',
      'node_modules',
      'src-tauri/target',
      'src-tauri/gen',
      'mcp/dist',
      '**/.shots',
      'kit',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden (docs/18).',
        },
        { selector: "CallExpression[callee.name='eval']", message: 'eval is forbidden (docs/18).' },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'new Function is forbidden (docs/18).',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: 'src/core must not import React.',
            },
            { group: ['node:*'], message: 'src/core must not import Node built-ins.' },
            { group: ['@tauri-apps/*'], message: 'src/core must not import Tauri APIs.' },
            { group: ['zustand', 'zustand/*'], message: 'src/core must not import the UI store.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...forbiddenCoreGlobals],
    },
  },
  {
    files: [
      '**/*.{js,mjs,cjs}',
      'scripts/**',
      'vite.config.ts',
      'vitest.config.ts',
      'eslint.config.js',
      'tests/e2e/**',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Plain scripts served as-is from public/ run in the browser (theme-init.js).
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
  {
    // Integration tests read JSON the servers under test produced: loosely typed on purpose.
    files: ['tests/mcp/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // page.evaluate() callbacks in e2e scripts execute inside the browser.
    files: ['tests/e2e/**', 'evals/**', 'scripts/capture-dom.mjs', 'scripts/render-site-shots.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
);
