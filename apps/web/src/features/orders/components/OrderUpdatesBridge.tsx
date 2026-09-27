import { useOrderUpdates } from '../hooks/useOrderUpdates';

/** Mounted once in the app shell: applies live order updates on every page (T-147). */
export function OrderUpdatesBridge() {
  useOrderUpdates();
  return null;
}
