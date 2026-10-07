// Fails when features import each other in a cycle (ADR 0005), e.g. funds → orders → funds.
// ESLint's no-restricted-imports keeps features behind their index.ts; this check keeps the
// feature graph acyclic. Shared state between features (query keys, coordination stores) belongs
// in shared/. Tests and stories are ignored: they never ship.
// Usage: node scripts/checkFeatureCycles.mjs <srcDir>
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const EXTENSIONS = new Set(['.ts', '.tsx']);
const IGNORED = /\.(test|stories)\.tsx?$/;
const FEATURE_IMPORT = /(?:from|import)\s*\(?\s*['"]@\/features\/([^/'"]+)/g;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (EXTENSIONS.has(extname(entry.name)) && !IGNORED.test(entry.name)) yield path;
  }
}

/** Feature name → the set of other features it imports. */
function featureGraph(featuresDir) {
  const graph = new Map();
  for (const entry of readdirSync(featuresDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const deps = new Set();
    for (const file of walk(join(featuresDir, entry.name))) {
      for (const match of readFileSync(file, 'utf8').matchAll(FEATURE_IMPORT)) {
        if (match[1] !== entry.name) deps.add(match[1]);
      }
    }
    graph.set(entry.name, deps);
  }
  return graph;
}

/** Every distinct cycle, each as a path that starts and ends at the same feature. */
function findCycles(graph) {
  const cycles = new Map();
  const state = new Map(); // undefined = unvisited, 1 = on the stack, 2 = done
  const stack = [];
  const visit = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 1) {
        const cycle = [...stack.slice(stack.indexOf(next)), next];
        const key = [...cycle.slice(0, -1)].sort().join(',');
        if (!cycles.has(key)) cycles.set(key, cycle);
      } else if (state.get(next) === undefined && graph.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const node of [...graph.keys()].sort()) if (state.get(node) === undefined) visit(node);
  return [...cycles.values()];
}

const root = process.argv[2] ?? 'src';
const featuresDir = join(root, 'features');
if (!existsSync(featuresDir)) process.exit(0);

const cycles = findCycles(featureGraph(featuresDir));
if (cycles.length > 0) {
  console.error('Features import each other in a cycle. Move what they share into shared/:');
  for (const cycle of cycles) console.error(`  ${cycle.join(' → ')}`);
  process.exit(1);
}
