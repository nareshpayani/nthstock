import { baseConfig } from '@nthstock/config/eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Import boundaries from ADR 0005: routes → features → shared → packages. Features are imported
// only through their index.ts; shared never reaches up into features, routes or app.
const deepFeatureImport = {
  regex: '^@/features/[^/]+/.+',
  message: 'Import a feature only through its index.ts (@/features/<name>). See ADR 0005.',
};
const upwardFromFeatures = {
  regex: '^@/(routes|app)(/|$)',
  message: 'Features must not import routes or app. See ADR 0005.',
};
const upwardFromShared = {
  regex: '^@/(features|routes|app)(/|$)',
  message: 'shared/ must not import features, routes or app. See ADR 0005.',
};
const relativeOutOfLayer = {
  regex: '^(\\.\\./)+(features|routes|app|shared)(/|$)',
  message: 'Use the @/ alias to cross layers. See ADR 0005.',
};
const appIntoPackages = {
  regex: '^@nthstock/[^/]+/(src|dist)/',
  message: 'Import packages by their public entry point.',
};

const restrict = (...patterns) => ({
  'no-restricted-imports': [
    'error',
    { patterns: [...patterns, relativeOutOfLayer, appIntoPackages] },
  ],
});

export default tseslint.config(
  {
    ignores: [
      'src/routeTree.gen.ts',
      'playwright-report/**',
      'test-results/**',
      'public/mockServiceWorker.js',
      'dist-api/**',
      'dist-e2e*/**',
      'dist-lhci/**',
      'lighthouse-report/**',
      '.lighthouseci/**',
    ],
  },
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules, ...restrict(deepFeatureImport) },
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
  { files: ['src/features/**/*.{ts,tsx}'], rules: restrict(deepFeatureImport, upwardFromFeatures) },
  { files: ['src/shared/**/*.{ts,tsx}'], rules: restrict(upwardFromShared) },
  {
    // The mock worker reports its own state in the browser console during development.
    files: ['src/mocks/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Storybook stories need a default export (CSF).
    files: ['**/*.stories.tsx'],
    rules: { 'no-restricted-exports': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  {
    // Lighthouse CI config (T-169): CommonJS, loaded by @lhci/cli under Node.
    files: ['lighthouserc.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
);
