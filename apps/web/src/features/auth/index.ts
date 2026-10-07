import { lazy } from 'react';

/**
 * The login flow, loaded on demand: the header (ProfileMenu) imports this feature on every page,
 * and the forms (React Hook Form, the steps) should load only on /login.
 */
export const LoginPage = lazy(() =>
  import('./components/LoginPage').then((module) => ({ default: module.LoginPage })),
);
export type { LoginPageProps } from './components/LoginPage';
export { ProfileMenu } from './components/ProfileMenu';
export { RequireSession } from './components/RequireSession';
