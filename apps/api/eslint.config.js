import { baseConfig } from '@nthstock/config/eslint';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Module boundaries (CLAUDE.md D5, .claude/rules/backend.md): a module under src/modules/<module>/
// is imported from outside only through its index.ts. Tests may import internals. Drizzle tables in
// src/db/schema/ read enum constants straight from a module's repo.ts/schema.ts, because the
// module's index.ts loads pgRepo.ts, which imports those tables (a load cycle).
const MODULE_INDEX_MESSAGE =
  'Import another module only through its index.ts (../<module>/index.js). See .claude/rules/backend.md.';
const TEST_FILES = ['**/*.test.ts', 'src/test/**'];

export default tseslint.config(
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/modules/**/*.ts'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^\\.\\./(?!\\.\\.)[^/]+/(?!index\\.js$)', message: MODULE_INDEX_MESSAGE },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/modules/**', 'src/db/schema/**', ...TEST_FILES],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(\\./|(\\.\\./)+)modules/[^/]+/(?!index\\.js$)',
              message: MODULE_INDEX_MESSAGE,
            },
          ],
        },
      ],
    },
  },
);
