import { baseConfig } from '@nthstock/config/eslint';
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
  { ignores: ['src/routeTree.gen.ts', 'playwright-report/**', 'test-results/**'] },
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules, ...restrict(deepFeatureImport) },
  },
  { files: ['src/features/**/*.{ts,tsx}'], rules: restrict(deepFeatureImport, upwardFromFeatures) },
  { files: ['src/shared/**/*.{ts,tsx}'], rules: restrict(upwardFromShared) },
  {
    // Storybook stories need a default export (CSF).
    files: ['**/*.stories.tsx'],
    rules: { 'no-restricted-exports': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
