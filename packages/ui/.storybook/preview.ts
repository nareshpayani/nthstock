import type { Preview } from '@storybook/react-vite';
import './preview.css';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    controls: { matchers: { color: /(background|color)$/i } },
    // axe runs on every story; any violation fails the Storybook test runner in CI (T-012).
    a11y: { test: 'error' },
  },
  tags: ['autodocs'],
};

export default preview;
