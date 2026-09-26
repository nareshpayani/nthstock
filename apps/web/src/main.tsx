import './styles/app.css';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './app/providers/AppProviders';
import { createQueryClient } from './app/queryClient';
import { createAppRouter } from './app/router';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
