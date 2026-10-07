import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { RouterContext } from '@/app/router/router';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
});
