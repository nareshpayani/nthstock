// Post-build budget checks for apps/web (T-010, CLAUDE.md §3):
// - fonts are self-hosted: no external font URLs, total woff2 under 100 KB;
// - initial JS (entry script plus modulepreloads) under 200 KB gzipped;
// - every page route is code-split into its own chunk (T-022);
// - icons are tree-shaken: only icons imported somewhere in src end up in the bundle (T-021);
// - mocks stay out of production paths (T-050): an api-mode build contains no MSW or mock-market
//   code at all, and in an msw-mode build they load lazily, never in the initial JS.
// Usage: node scripts/checkBuild.mjs [distDir]   (default dist)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { allIcons } from '@nthstock/ui/allIcons';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const DIST = process.argv[2] ?? 'dist';

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(tsx?|js)$/.test(entry.name)) yield path;
  }
}
function* walkAll(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkAll(path);
    else if (/\.(js|html)$/.test(entry.name)) yield path;
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

// Strings only MSW (its client and service worker) or the mock market contain.
const MOCK_MARKERS = [/\[MSW\]/, /mockServiceWorker/, /INTEGRITY_CHECK_REQUEST/, /NIFTYMIDCAP100/];
const hasMockCode = (text) => MOCK_MARKERS.some((marker) => marker.test(text));
const apiMode = /<meta name="nthstock-api-mode" content="(msw|api)"/.exec(html)?.[1];
if (!apiMode) failures.push('index.html has no nthstock-api-mode meta tag');
const shipped = [...walkAll(DIST)];
const mockFiles = shipped.filter((file) => hasMockCode(readFileSync(file, 'utf8')));
if (apiMode === 'api' && mockFiles.length > 0) {
  failures.push(`api-mode build contains MSW or mock code: ${mockFiles.join(', ')}`);
}
if (apiMode === 'msw') {
  const eager = initialScripts.filter((file) =>
    hasMockCode(readFileSync(join(DIST, file), 'utf8')),
  );
  if (eager.length > 0) failures.push(`MSW or mock code in the initial JS: ${eager.join(', ')}`);
  if (!shipped.some((file) => file.endsWith('mockServiceWorker.js'))) {
    failures.push('msw-mode build is missing mockServiceWorker.js');
  }
}
const mockJs = mockFiles
  .filter((file) => file.endsWith('.js') && !file.endsWith('mockServiceWorker.js'))
  .reduce((sum, file) => sum + gzipSync(readFileSync(file)).length, 0);

const ROUTE_CHUNKS = ['dashboard', 'portfolio', 'positions', 'orders', 'funds', 'login', '_symbol'];
const missingChunks = ROUTE_CHUNKS.filter(
  (name) => !assets.some((file) => file.startsWith(`${name}-`) && file.endsWith('.js')),
);
if (missingChunks.length > 0)
  failures.push(`routes without their own chunk: ${missingChunks.join(', ')}`);

const allJs = assets
  .filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(join(DIST, 'assets', file), 'utf8'))
  .join('\n');
// Icons the app imports, plus icons that @nthstock/ui components use internally
// (EmptyState's inbox, Dialog's close button, …).
const uiComponents = new URL('./components/', import.meta.resolve('@nthstock/ui'));
const importedIcons = new Set();
for (const file of [
  ...walk('src'),
  ...readdirSync(uiComponents).map((name) => new URL(name, uiComponents).pathname),
]) {
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

console.log(
  `checkBuild: route chunks ${String(ROUTE_CHUNKS.length - missingChunks.length)}/${String(ROUTE_CHUNKS.length)}`,
);
console.log(`checkBuild: icons bundled [${bundledIcons.join(', ')}]`);
console.log(
  `checkBuild: fonts ${(fontBytes / 1024).toFixed(1)} KB woff2, initial JS ${(initialJs / 1024).toFixed(1)} KB gzipped (${String(initialScripts.length)} files)`,
);
console.log(
  `checkBuild: ${DIST} is an ${String(apiMode)}-mode build; lazy mock JS ${(mockJs / 1024).toFixed(1)} KB gzipped`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`checkBuild: ${failure}`);
  process.exit(1);
}
