// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/** Node built-ins that do I/O or touch the process. The pure layers must not import them. */
const NODE_IO = [
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'net',
  'os',
  'path',
  'process',
  'tls',
  'worker_threads',
];

/** Import bans for the pure layers (see docs/architecture.md): no VS Code, no Node I/O, no adapters. */
function pureLayer(/** @type {string} */ layer) {
  return {
    files: [`src/${layer}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              message: `src/${layer} must stay free of VS Code APIs (docs/architecture.md).`,
            },
            ...NODE_IO.map((name) => ({
              name,
              message: `src/${layer} is pure: no Node I/O (docs/architecture.md).`,
            })),
          ],
          patterns: [
            {
              group: ['node:*'],
              message: `src/${layer} is pure: no Node built-ins (docs/architecture.md).`,
            },
            {
              group: ['**/adapters', '**/adapters/*', '**/extension', '**/client/*'],
              message: `src/${layer} must not depend on the imperative shell (docs/architecture.md).`,
            },
          ],
        },
      ],
    },
  };
}

export default defineConfig(
  {
    // Hidden top-level folders are tool or local state (the same rule as .prettierignore).
    ignores: ['dist/', 'out/', 'coverage/', 'node_modules/', 'test/fixtures/', '.*/'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs', '.vscode-test.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  pureLayer('core'),
  pureLayer('render'),
  {
    // The browser sidebar script: DOM only, never Node or VS Code.
    files: ['src/client/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'vscode', message: 'src/client runs in the browser.' }],
          patterns: [{ group: ['node:*', '../*'], message: 'src/client is self-contained.' }],
        },
      ],
    },
  },
  {
    // Plain JavaScript config files: no type information. Merge with
    // disableTypeChecked's own keys; overriding them would re-enable typed rules.
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { process: 'readonly', URL: 'readonly', console: 'readonly' },
    },
    rules: { ...tseslint.configs.disableTypeChecked.rules, 'no-console': 'off' },
  },
  {
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
);
