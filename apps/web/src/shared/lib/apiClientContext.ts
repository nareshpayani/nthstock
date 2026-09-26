import { createApiClient, type ApiClient } from '@nthstock/apiClient';
import { createContext, useContext } from 'react';

/** Same-origin client, used when no provider is mounted (Storybook without data, simple tests). */
const defaultClient = createApiClient();

export const ApiClientContext = createContext<ApiClient>(defaultClient);

/** The app's typed REST client (packages/apiClient). Provided once by AppProviders. */
export function useApiClient(): ApiClient {
  return useContext(ApiClientContext);
}
