// Public API of the users module. Other modules and the app wiring import it only through this
// file; tests may import internals.
export { createPgUsersRepo } from './pgRepo.js';
export {
  DEMO_USER,
  DuplicateMobileError,
  createMemoryUsersRepo,
  type ConsentGrant,
  type ConsentRecord,
  type DeletedUser,
  type UserRecord,
  type UsersRepo,
} from './repo.js';
export { maskMobile, toUser } from './service.js';
