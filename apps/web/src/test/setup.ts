import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { configure } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// Route pages are lazy chunks, and a busy CI runner has taken over 1 s (findBy's default) to
// load one on first navigation. Waiting longer changes nothing when the page is already there.
configure({ asyncUtilTimeout: 5_000 });
