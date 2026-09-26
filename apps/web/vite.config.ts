import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { devProxy } from './src/app/devProxy.ts';
import { parseRuntimeConfig, type ApiMode } from './src/app/runtimeConfig.ts';

/** Adds <link rel="preload"> for every self-hosted woff2 font in the production bundle (T-010). */
function preloadFonts(): Plugin {
  return {
    name: 'nthstock:preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const fonts = Object.keys(ctx.bundle ?? {}).filter((file) => file.endsWith('.woff2'));
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

export default defineConfig(({ mode }) => {
  // Validate VITE_* at start-up so a typo in the mode fails `vite`, `vite build` and Vitest at once.
  const runtime = parseRuntimeConfig(loadEnv(mode, process.cwd(), 'VITE_'));
  // api mode (T-076): /v1 → apps/api and /ws → apps/realtime, same origin for cookies.
  const proxy = devProxy(runtime.apiMode, loadEnv(mode, process.cwd(), ''));
  return {
    // The mode is a build-time constant: main.tsx's `=== 'msw'` check folds away in api builds,
    // taking the dynamic MSW import with it.
    define: { 'import.meta.env.VITE_API_MODE': JSON.stringify(runtime.apiMode) },
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
      alias: { '@': decodeURIComponent(new URL('./src', import.meta.url).pathname) },
    },
    server: { port: 5173, ...(proxy ? { proxy } : {}) },
    preview: { port: 4173, ...(proxy ? { proxy } : {}) },
    // The lazy MSW + mock-market chunk (msw mode only) is large by nature; real budgets are
    // enforced by scripts/checkBuild.mjs on the initial JS.
    build: { chunkSizeWarningLimit: 1_000 },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
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
