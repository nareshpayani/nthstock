import { createContext } from 'react';

/**
 * True inside the app shell's main area. A route skeleton shown before the shell has rendered (a
 * cold load) draws the shell's header and rail too, so the first frame already has the page's shape.
 */
export const InShellContext = createContext(false);
