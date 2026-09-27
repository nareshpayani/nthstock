/**
 * Query keys for the order book (ADR 0005: `[feature, entity, params]`). The order book page
 * (T-144) adds its list queries under `ordersKeys.all`; the order ticket invalidates that prefix
 * after placing an order, so every orders query refetches.
 */
export const ordersKeys = {
  all: ['orders'] as const,
  list: (params: { status?: string | undefined } = {}) => ['orders', 'list', params] as const,
};
