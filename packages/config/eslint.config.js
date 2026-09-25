import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Shared ESLint flat config for every nthstock workspace.
 * Apps extend this and add framework-specific rules.
 */
export const baseConfig = tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-exports': ['error', { restrictDefaultExports: { direct: true } }],
    },
  },
  {
    // Tool config files (vite, vitest, eslint) are required to use default exports.
    files: ['**/*.config.{js,ts}'],
    rules: { 'no-restricted-exports': 'off' },
  },
);
