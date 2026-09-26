import type { Meta, StoryObj } from '@storybook/react-vite';

/**
 * A deliberately failing story that proves axe runs in CI (T-012). Tagged `a11y-canary`, so the
 * normal test run skips it; CI runs it alone and expects the run to fail.
 */
function LowContrastText() {
  return <p className="bg-surface p-4 text-line">This text is far below 4.5:1 contrast.</p>;
}

const meta = {
  title: 'Internal/A11y canary',
  component: LowContrastText,
  tags: ['a11y-canary', '!autodocs'],
} satisfies Meta<typeof LowContrastText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LowContrast: Story = {};
