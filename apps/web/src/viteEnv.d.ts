/// <reference types="vite/client" />

// Typed VITE_* variables (T-049). Values are validated by src/app/runtimeConfig.ts.
interface ImportMetaEnv {
  readonly VITE_API_MODE?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_MOCK_MARKET_OPEN?: string;
}
