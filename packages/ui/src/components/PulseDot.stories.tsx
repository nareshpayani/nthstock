import type { Meta, StoryObj } from '@storybook/react-vite';
import { PulseDot } from './PulseDot.js';

// PulseDot (NSTOCK-0462): a dot that pings a fading ring for something new. Decorative; the caller
// says "Unread" in text. With reduced motion on, only the dot shows.
const meta = {
  title: 'Feedback/PulseDot',
  component: PulseDot,
} satisfies Meta<typeof PulseDot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Brand: Story = { args: { tone: 'brand' } };

export const Down: Story = { args: { tone: 'down' } };

export const BothTones: Story = {
  render: () => (
    <div className="flex items-center gap-6 p-4">
      <PulseDot tone="brand" />
      <PulseDot tone="down" />
    </div>
  ),
};
