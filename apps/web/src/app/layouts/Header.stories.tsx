import type { Meta, StoryObj } from '@storybook/react-vite';
import { TooltipProvider } from '@nthstock/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { useState } from 'react';
import { signIn, signOut, testSession } from '@/test/session';
import { Header } from './Header';

type DemoProps = { signedInAs: string | null };

// Header needs a router for its links and a query client for logout; each story mounts both.
function WithRouter({ signedInAs }: DemoProps) {
  const [setup] = useState(() => {
    if (signedInAs) signIn(testSession({ name: signedInAs }));
    else signOut();
    const root = createRootRoute({
      component: () => <Header onOpenMenu={() => undefined} onOpenHelp={() => undefined} />,
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
    });
    return { router, queryClient: new QueryClient() };
  });
  return (
    <QueryClientProvider client={setup.queryClient}>
      <TooltipProvider>
        {/* A story router, not the app's registered router type. */}
        <RouterProvider router={setup.router as never} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'App/Header',
  component: WithRouter,
  parameters: { layout: 'fullscreen' },
  args: { signedInAs: null },
} satisfies Meta<typeof WithRouter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedOut: Story = {};
export const SignedIn: Story = { args: { signedInAs: 'Asha Rao' } };
