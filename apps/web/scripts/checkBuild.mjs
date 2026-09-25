// Post-build budget checks for apps/web (T-010, CLAUDE.md §3):
// - fonts are self-hosted: no external font URLs, total woff2 under 100 KB;
// - initial JS (entry script plus modulepreloads) under 200 KB gzipped;
// - icons are tree-shaken: only icons imported somewhere in src end up in the bundle (T-021).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { allIcons } from '@nthstock/ui/allIcons';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const DIST = 'dist';

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.tsx?$/.test(entry.name)) yield path;
  }
}
const FONT_BUDGET = 100 * 1024;
const INITIAL_JS_BUDGET = 200 * 1024;
const failures = [];

const assets = readdirSync(join(DIST, 'assets'));
const fontBytes = assets
  .filter((file) => file.endsWith('.woff2'))
  .reduce((sum, file) => sum + statSync(join(DIST, 'assets', file)).size, 0);
if (fontBytes > FONT_BUDGET)
  failures.push(`woff2 total ${String(fontBytes)} B > ${String(FONT_BUDGET)} B`);
if (assets.some((file) => /\.(woff|ttf|otf|eot)$/.test(file)))
  failures.push('non-woff2 font emitted');

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const css = assets.filter((file) => file.endsWith('.css'));
for (const text of [html, ...css.map((file) => readFileSync(join(DIST, 'assets', file), 'utf8'))]) {
  if (/fonts\.(googleapis|gstatic)\.com|url\(["']?https?:/.test(text)) {
    failures.push('external font or url() request found');
  }
}

const initialScripts = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const initialJs = initialScripts.reduce(
  (sum, file) => sum + gzipSync(readFileSync(join(DIST, file))).length,
  0,
);
if (initialJs > INITIAL_JS_BUDGET) {
  failures.push(`initial JS ${String(initialJs)} B gzipped > ${String(INITIAL_JS_BUDGET)} B`);
}

const allJs = assets
  .filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(join(DIST, 'assets', file), 'utf8'))
  .join('\n');
const importedIcons = new Set();
for (const file of walk('src')) {
  for (const match of readFileSync(file, 'utf8').matchAll(/\bIcon[A-Z]\w*/g))
    importedIcons.add(match[0]);
}
// Every icon draws at least one <path>; its first `d` string is a fingerprint in the minified JS.
const bundledIcons = allIcons
  .filter(([, Icon]) => {
    const d = / d="([^"]+)"/.exec(renderToStaticMarkup(createElement(Icon)))?.[1];
    // Matched as a whole string literal in any quote style, so "M5 12h14" does not match inside
    // another icon's longer path.
    return d !== undefined && ['"', "'", '`'].some((q) => allJs.includes(`${q}${d}${q}`));
  })
  .map(([name]) => name);
const strayIcons = bundledIcons.filter((name) => !importedIcons.has(name));
if (strayIcons.length > 0) failures.push(`unused icons in the bundle: ${strayIcons.join(', ')}`);

console.log(`checkBuild: icons bundled [${bundledIcons.join(', ')}]`);
console.log(
  `checkBuild: fonts ${(fontBytes / 1024).toFixed(1)} KB woff2, initial JS ${(initialJs / 1024).toFixed(1)} KB gzipped (${String(initialScripts.length)} files)`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`checkBuild: ${failure}`);
  process.exit(1);
}
