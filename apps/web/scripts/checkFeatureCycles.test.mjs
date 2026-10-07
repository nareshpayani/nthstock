import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR 0005: the lint step fails when two or more features import each other in a cycle.
function runCheck(dir) {
  try {
    execFileSync('node', ['scripts/checkFeatureCycles.mjs', dir], { stdio: 'pipe' });
    return 0;
  } catch (error) {
    return error.status;
  }
}

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'nth-cycles-'));
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, 'features', name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

describe('checkFeatureCycles', () => {
  it('fails on a two-feature cycle', () => {
    const dir = fixture({
      'funds/hooks/useReset.ts': "import { ordersKeys } from '@/features/orders';\n",
      'orders/hooks/useCancel.ts': "import { fundsKeys } from '@/features/funds';\n",
    });
    expect(runCheck(dir)).toBe(1);
  });

  it('fails on a longer cycle, including a lazy import', () => {
    const dir = fixture({
      'a/index.ts': "export { b } from '@/features/b';\n",
      'b/index.ts': "export { c } from '@/features/c';\n",
      'c/index.ts': "export const load = () => import('@/features/a');\n",
    });
    expect(runCheck(dir)).toBe(1);
  });

  it('passes a one-way dependency and ignores tests', () => {
    const dir = fixture({
      'orderTicket/index.ts': "import { fundsSummaryQuery } from '@/features/funds';\n",
      'funds/index.ts': "import { fundsKeys } from '@/shared/lib/queryKeys';\n",
      'funds/Funds.test.ts': "import { OrderTicket } from '@/features/orderTicket';\n",
    });
    expect(runCheck(dir)).toBe(0);
  });

  it('passes the real apps/web/src', () => {
    expect(runCheck('src')).toBe(0);
  });
});
