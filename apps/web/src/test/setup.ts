import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach } from 'vitest';
import { configure } from '@testing-library/react';
import { resetTestCookies } from '@/mocks/handlerKit';

afterEach(() => {
  cleanup();
  resetTestCookies();
});

// The router shows a pending page after `defaultPendingMs` (150 ms) by timer. If a file's last
// test ends during a navigation, that timer fires after jsdom has closed and fails the run with
// "window is not defined"; let it run while the environment is still up.
afterAll(() => new Promise<void>((resolve) => setTimeout(resolve, 250)));

// Route pages are lazy chunks, and a busy CI runner has taken over 1 s (findBy's default) to
// load one on first navigation. Waiting longer changes nothing when the page is already there.
configure({ asyncUtilTimeout: 5_000 });
