import type { Order } from '@nthstock/contracts';
import { createContext, useContext } from 'react';

/**
 * Where the user's own order updates arrive (T-147): `orderUpdate` messages on the app's
 * WebSocket (apps/realtime in api mode, the MSW mock socket in msw mode).
 */
export type OrderUpdateSource = {
  /** Every order change of the signed-in user; returns the unsubscribe. */
  onOrderUpdate(listener: (order: Order) => void): () => void;
  /** Opens the socket even when no price is on screen, so updates can arrive. */
  connect(): void;
};

/** A source that never delivers: tests and Storybook without a socket. */
export const detachedOrderUpdates: OrderUpdateSource = {
  onOrderUpdate: () => () => undefined,
  connect: () => undefined,
};

export const OrderUpdatesContext = createContext<OrderUpdateSource>(detachedOrderUpdates);

/** The app's order update source. Provided once by AppProviders. */
export function useOrderUpdateSource(): OrderUpdateSource {
  return useContext(OrderUpdatesContext);
}
