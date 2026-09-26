import { baseConfig } from '@nthstock/config/eslint';
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
