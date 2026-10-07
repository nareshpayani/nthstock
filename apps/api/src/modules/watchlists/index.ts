// Public API of the watchlists module. Other modules and the app wiring import it only through
// this file; tests may import internals.
export { createPgWatchlistsRepo } from './pgRepo.js';
export { createMemoryWatchlistsRepo, type WatchlistsRepo } from './repo.js';
export { watchlistRoutes } from './routes.js';
export type { WatchlistItemRecord, WatchlistRecord } from './schema.js';
