// Post-build budget checks for apps/web (T-010, CLAUDE.md §3):
// - fonts are self-hosted: no external font URLs, total woff2 under 100 KB;
// - initial JS (entry script plus modulepreloads) under 200 KB gzipped.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist';
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

console.log(
  `checkBuild: fonts ${(fontBytes / 1024).toFixed(1)} KB woff2, initial JS ${(initialJs / 1024).toFixed(1)} KB gzipped (${String(initialScripts.length)} files)`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`checkBuild: ${failure}`);
  process.exit(1);
}
