import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

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

export default defineConfig({
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
  ],
  resolve: {
    alias: { '@': decodeURIComponent(new URL('./src', import.meta.url).pathname) },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
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
});
