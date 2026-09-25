import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  // Design-system stories plus app/feature stories from apps/web (ADR 0005, UI-07).
  stories: ['../src/**/*.stories.@(ts|tsx)', '../../../apps/web/src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal(viteConfig) {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()];
    // apps/web stories import through its @/ alias.
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: {
        ...(viteConfig.resolve?.alias as Record<string, string> | undefined),
        '@': decodeURIComponent(new URL('../../../apps/web/src', import.meta.url).pathname),
      },
    };
    return viteConfig;
  },
};

export default config;
