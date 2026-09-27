import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// T-168: `npm run build` (and so CI) fails when the bundle budget is broken. These fixtures are
// tiny fake dist folders; each asserts the one failure it provokes (a fixture is never a complete
// build, so other checks fail too and the exit code is 1 either way).
function runCheck(files) {
  const dir = mkdtempSync(join(tmpdir(), 'nth-build-'));
  mkdirSync(join(dir, 'assets'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const result = spawnSync('node', ['scripts/checkBuild.mjs', dir], { encoding: 'utf8' });
  return { status: result.status, errors: result.stderr, out: result.stdout };
}

const page = (scripts, mode = 'msw') =>
  `<!doctype html><html><head><meta name="nthstock-api-mode" content="${mode}">${scripts
    .map((src) => `<script type="module" src="/${src}"></script>`)
    .join('')}</head><body></body></html>`;

describe('checkBuild', () => {
  it('fails when the initial JS is over 200 KB gzipped', () => {
    // Random bytes do not compress, so 260 KB of them stays well over the budget.
    const big = `export const blob = "${randomBytes(260 * 1024).toString('base64')}";`;
    const { status, errors } = runCheck({
      'index.html': page(['assets/index-a.js']),
      'assets/index-a.js': big,
    });
    expect(status).toBe(1);
    expect(errors).toMatch(/initial JS \d+ B gzipped > 204800 B/);
  });

  it('does not flag a small initial JS', () => {
    const { errors } = runCheck({
      'index.html': page(['assets/index-a.js']),
      'assets/index-a.js': 'export const x = 1;',
    });
    expect(errors).not.toMatch(/initial JS \d+ B gzipped >/);
  });

  it('fails when the charts library is in the initial JS instead of a lazy chunk', () => {
    const { status, errors } = runCheck({
      'index.html': page(['assets/index-a.js']),
      'assets/index-a.js': 'const root = "tv-lightweight-charts";',
    });
    expect(status).toBe(1);
    expect(errors).toMatch(/charts library in the initial JS: assets\/index-a\.js/);
  });

  it('fails when no chunk holds the charts library', () => {
    const { errors } = runCheck({
      'index.html': page(['assets/index-a.js']),
      'assets/index-a.js': 'export const x = 1;',
    });
    expect(errors).toMatch(/charts library not found in any chunk/);
  });

  it('fails a build that carries the MSW test controls (T-162)', () => {
    const { status, errors } = runCheck({
      'index.html': page(['assets/index-a.js']),
      'assets/index-a.js': 'export const x = 1;',
      'assets/testControls-a.js': 'http.post("*/v1/__test/clock")',
    });
    expect(status).toBe(1);
    expect(errors).toMatch(/build contains test controls/);
  });
});
