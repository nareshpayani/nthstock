import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

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
  plugins: [tailwindcss(), react(), preloadFonts()],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
