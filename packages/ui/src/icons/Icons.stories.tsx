import type { Meta, StoryObj } from '@storybook/react-vite';
import { allIcons } from './allIcons.js';
import { Logo } from './Logo.js';

const meta = {
  title: 'Brand/Icons and logo',
  component: Logo,
} satisfies Meta<typeof Logo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LogoStory: Story = {
  name: 'Logo',
  render: () => (
    <div className="flex items-center gap-8">
      <Logo />
      <Logo withWordmark={false} />
    </div>
  ),
};

export const Gallery: Story = {
  render: () => (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
      {allIcons.map(([exportName, Icon]) => (
        <li
          key={exportName}
          className="flex flex-col items-center gap-2 rounded-md border border-line bg-surface p-3 text-ink"
        >
          <Icon size={24} />
          <code className="font-mono text-label text-ink-muted">{exportName}</code>
        </li>
      ))}
    </ul>
  ),
};
