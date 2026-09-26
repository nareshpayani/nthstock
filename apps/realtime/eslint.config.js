import { baseConfig } from '@nthstock/config/eslint';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(...baseConfig, {
  files: ['**/*.ts'],
  languageOptions: { globals: globals.node },
});
