import type { Meta, StoryObj } from '@storybook/react-vite';
import { TooltipProvider } from '@nthstock/ui';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { Header, type HeaderProps } from './Header';

// Header needs a router for its links; each story mounts it in a one-route memory router.
function WithRouter(props: HeaderProps) {
  const root = createRootRoute({ component: () => <Header {...props} /> });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
  });
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  );
}

const meta = {
  title: 'App/Header',
  component: WithRouter,
  parameters: { layout: 'fullscreen' },
  args: { user: null, onOpenMenu: () => undefined, onOpenHelp: () => undefined },
} satisfies Meta<typeof WithRouter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedOut: Story = {};
export const SignedIn: Story = { args: { user: { name: 'Asha Rao' } } };
