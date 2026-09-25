import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// T-009: the lint step fails on hard-coded hex colours in apps/web/src.
function runCheck(dir) {
  try {
    execFileSync('node', ['scripts/checkNoHex.mjs', dir], { stdio: 'pipe' });
    return 0;
  } catch (error) {
    return error.status;
  }
}

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'nth-hex-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe('checkNoHex', () => {
  it('fails on a hex colour in TSX or CSS', () => {
    expect(runCheck(fixture({ 'a.tsx': 'const c = "#1D4E6B";' }))).toBe(1);
    expect(runCheck(fixture({ 'a.css': '.x { color: #fff; }' }))).toBe(1);
  });

  it('passes token classes and CSS variables', () => {
    expect(runCheck(fixture({ 'a.tsx': '<p className="text-up bg-surface" />' }))).toBe(0);
    expect(runCheck(fixture({ 'a.css': '.x { color: var(--nth-color-ink); }' }))).toBe(0);
  });

  it('passes the real apps/web/src', () => {
    expect(runCheck('src')).toBe(0);
  });
});
