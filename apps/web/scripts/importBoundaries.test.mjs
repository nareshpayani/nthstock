// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// ADR 0005 import boundaries are enforced by no-restricted-imports in eslint.config.js.
const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });

async function errorsFor(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports').length;
}

describe('import boundaries', () => {
  it('blocks deep imports into a feature', async () => {
    const code =
      "import { strings } from '@/features/watchlist/strings';\nexport const s = strings;\n";
    expect(await errorsFor('src/app/x.ts', code)).toBe(1);
  });

  it('blocks shared importing features, and features importing routes or app', async () => {
    const shared = "import { SearchBox } from '@/features/search';\nexport const x = SearchBox;\n";
    expect(await errorsFor('src/shared/x.ts', shared)).toBe(1);
    const feature =
      "import { createAppRouter } from '@/app/router';\nexport const x = createAppRouter;\n";
    expect(await errorsFor('src/features/orders/x.ts', feature)).toBe(1);
  });

  it('allows a feature through its index', async () => {
    const code = "import { SearchBox } from '@/features/search';\nexport const x = SearchBox;\n";
    expect(await errorsFor('src/app/x.ts', code)).toBe(0);
  });
});
