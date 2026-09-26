import { baseConfig } from '@nthstock/config/eslint';
import tseslint from 'typescript-eslint';

// Isomorphic package: runs in the browser and in Node, so no environment globals.
export default tseslint.config(...baseConfig);
