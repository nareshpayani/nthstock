// Fails when a hard-coded hex colour appears in the given folder (T-009). Colours come from
// @nthstock/tokens classes (bg-surface, text-up, …) or var(--nth-color-*) only.
// Usage: node scripts/checkNoHex.mjs <dir>
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/gi;
const EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.html', '.svg']);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (EXTENSIONS.has(extname(entry.name)) && !entry.name.endsWith('.gen.ts')) yield path;
  }
}

const root = process.argv[2] ?? 'src';
const hits = [];
for (const file of walk(root)) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      for (const match of line.matchAll(HEX))
        hits.push(`${file}:${String(index + 1)}: ${match[0]}`);
    });
}

if (hits.length > 0) {
  console.error('Hard-coded hex colours found. Use token classes or var(--nth-color-*) instead:');
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
