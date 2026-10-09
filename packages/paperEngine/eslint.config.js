import { baseConfig } from '@nthstock/config/eslint';
import tseslint from 'typescript-eslint';

// Isomorphic package: runs in the browser and in Node, so no environment globals and no Node
// imports (T-199). Typecheck has no Node types either.
const NODE_ONLY = 'paperEngine must run in the browser: no Node imports.';

export default tseslint.config(...baseConfig, {
  files: ['src/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: ['node:*'], message: NODE_ONLY },
          {
            group: ['fs', 'path', 'crypto', 'os', 'child_process', 'stream', 'buffer', 'util'],
            message: NODE_ONLY,
          },
        ],
      },
    ],
  },
});
