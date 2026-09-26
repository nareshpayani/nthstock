import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fontFiles, toFontFaces } from './fonts.js';
import { toCssVariables, toTailwindTheme } from './generate.js';

// Runs after tsc (npm run build) and writes the generated stylesheets and fonts into dist/.
const require = createRequire(import.meta.url);
const dist = dirname(new URL(import.meta.url).pathname);
writeFileSync(join(dist, 'tokens.css'), toCssVariables());
writeFileSync(join(dist, 'tailwind.css'), toTailwindTheme());

mkdirSync(join(dist, 'fonts'), { recursive: true });
for (const font of fontFiles) {
  const packageRoot = dirname(require.resolve(`${font.source}/package.json`));
  copyFileSync(join(packageRoot, 'files', font.file), join(dist, 'fonts', font.file));
}
writeFileSync(join(dist, 'fonts.css'), toFontFaces());
