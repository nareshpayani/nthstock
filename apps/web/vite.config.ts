import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { devProxy } from './src/app/config/devProxy.ts';
import { parseRuntimeConfig, type ApiMode } from './src/app/config/runtimeConfig.ts';
import { webSecurityHeaders } from './src/app/config/securityHeaders.ts';

/**
 * Adds <link rel="preload"> for the body face, IBM Plex Sans 400, in the production bundle (T-010).
 * The other weights and Plex Mono load on use: their metric-matched fallbacks (CR-T19) keep the
 * swap from shifting text, and on a slow phone network they would otherwise compete with the
 * entry script for the first second.
 */
function preloadFonts(): Plugin {
  return {
    name: 'nthstock:preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const fonts = Object.keys(ctx.bundle ?? {}).filter((file) =>
          /ibm-plex-sans-latin-400-normal.*\.woff2$/.test(file),
        );
        return fonts.map((file) => ({
          tag: 'link',
          attrs: {
            rel: 'preload',
            href: `/${file}`,
            as: 'font',
            type: 'font/woff2',
            crossorigin: '',
          },
          injectTo: 'head',
        }));
      },
    },
  };
}

/**
 * Build-mode bookkeeping (T-050): tags index.html with the API mode for scripts/checkBuild.mjs, and
 * drops the MSW service worker that public/ would otherwise copy into an api-mode build.
 */
function apiModeBuild(apiMode: ApiMode): Plugin {
  let outDir = 'dist';
  return {
    name: 'nthstock:api-mode',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { name: 'nthstock-api-mode', content: apiMode }, injectTo: 'head' },
    ],
    closeBundle() {
      if (apiMode === 'api') rmSync(resolve(outDir, 'mockServiceWorker.js'), { force: true });
    },
  };
}

/**
 * The workspace packages the app imports, mapped to their TypeScript source. Their package.json
 * points at the built `dist`, which goes stale after a pull or while a package is edited, so the
 * dev server reads the source instead (NSTOCK-0361). Only the `@nthstock/tokens` CSS stays on `dist`
 * because it is generated (`predev` builds it); its TypeScript exports come from source, so a new token
 * such as `spring` works without a rebuild (NSTOCK-0434).
 */
const PACKAGE_SOURCES: Record<string, string> = {
  '@nthstock/apiClient': 'apiClient/src/index.ts',
  '@nthstock/contracts': 'contracts/src/index.ts',
  '@nthstock/contracts/testing': 'contracts/src/testing/index.ts',
  '@nthstock/marketData': 'marketData/src/index.ts',
  '@nthstock/marketData/testing': 'marketData/src/testing.ts',
  '@nthstock/paperEngine': 'paperEngine/src/index.ts',
  '@nthstock/tokens': 'tokens/src/index.ts',
  '@nthstock/ui': 'ui/src/index.ts',
  '@nthstock/ui/allIcons': 'ui/src/icons/allIcons.ts',
  '@nthstock/utils': 'utils/src/index.ts',
};

const packagesDir = decodeURIComponent(new URL('../../packages/', import.meta.url).pathname);
const sourceAliases = Object.entries(PACKAGE_SOURCES).map(([name, path]) => ({
  find: new RegExp(`^${name}$`),
  replacement: resolve(packagesDir, path),
}));

export default defineConfig(({ command, mode }) => {
  // Only the dev server reads package source; builds, previews and Vitest keep the published dist.
  const fromSource = command === 'serve' && mode !== 'test' && !process.env['VITEST'];
  // Validate VITE_* at start-up so a typo in the mode fails `vite`, `vite build` and Vitest at once.
  const runtime = parseRuntimeConfig(loadEnv(mode, process.cwd(), 'VITE_'));
  // api mode (T-076): /v1 → apps/api and /ws → apps/realtime, same origin for cookies.
  const serverEnv = loadEnv(mode, process.cwd(), '');
  const proxy = devProxy(runtime.apiMode, serverEnv);
  // T-173: CSP, X-Frame-Options DENY and friends on the preview server (not the dev server, whose
  // HMR client needs inline scripts); HSTS only when SECURITY_HSTS=true, i.e. served over HTTPS.
  const securityHeaders = webSecurityHeaders({
    apiBaseUrl: runtime.apiBaseUrl,
    wsUrl: runtime.wsUrl,
    hsts: serverEnv['SECURITY_HSTS'] === 'true',
  });
  return {
    // The mode is a build-time constant: main.tsx's `=== 'msw'` check folds away in api builds,
    // taking the dynamic MSW import with it.
    // VITE_TEST_CONTROLS (E2E builds, T-162) is folded the same way, so no other build carries
    // the MSW /v1/__test handlers.
    define: {
      'import.meta.env.VITE_API_MODE': JSON.stringify(runtime.apiMode),
      'import.meta.env.VITE_TEST_CONTROLS': JSON.stringify(String(runtime.testControls)),
    },
    plugins: [
      // File routes in src/routes (ADR 0005); each route becomes its own lazy chunk.
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
        quoteStyle: 'single',
      }),
      tailwindcss(),
      react(),
      preloadFonts(),
      apiModeBuild(runtime.apiMode),
    ],
    resolve: {
      alias: [
        ...(fromSource ? sourceAliases : []),
        { find: '@', replacement: decodeURIComponent(new URL('./src', import.meta.url).pathname) },
      ],
    },
    server: { port: 5173, ...(proxy ? { proxy } : {}) },
    preview: { port: 4173, headers: securityHeaders, ...(proxy ? { proxy } : {}) },
    // The lazy MSW + mock-market chunk (msw mode only) is large by nature; real budgets are
    // enforced by scripts/checkBuild.mjs on the initial JS.
    build: { chunkSizeWarningLimit: 1_000 },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Above the 5 s asyncUtilTimeout in src/test/setup.ts, so a test that waits on two lazy route
      // chunks on a busy CI runner can still finish, and a findBy timeout reports its own error.
      testTimeout: 15_000,
      exclude: [...configDefaults.exclude, 'e2e/**'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        // Route files are one-line wiring rewritten by the code-splitting plugin; the pages they
        // render are covered through the router tests.
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/**/*.stories.tsx',
          'src/test/**',
          'src/routes/**',
          'src/routeTree.gen.ts',
          'src/main.tsx',
        ],
        thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
  };
});
