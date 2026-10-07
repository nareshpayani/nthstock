import { baseConfig } from '@nthstock/config/eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['storybook-static/**'] },
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  // WCAG 2.2 AA in JSX (CLAUDE.md §6): the strict jsx-a11y set, for every component.
  {
    files: ['**/*.tsx'],
    ...jsxA11y.configs.strict,
    rules: {
      ...jsxA11y.configs.strict.rules,
      // A scrollable region must take focus for keyboard scrolling (axe scrollable-region-focusable).
      'jsx-a11y-x/no-noninteractive-tabindex': ['error', { roles: ['region', 'tabpanel'] }],
    },
  },
  // Tests render components with props such as autoFocus to check them.
  { files: ['**/*.test.tsx'], rules: { 'jsx-a11y-x/no-autofocus': 'off' } },
  {
    // Storybook's CSF format and config files require default exports.
    files: ['**/*.stories.tsx', '.storybook/**'],
    rules: { 'no-restricted-exports': 'off' },
  },
  {
    files: ['.storybook/**/*.{js,cjs}', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
);
