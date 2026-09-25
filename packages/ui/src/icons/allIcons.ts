import type { IconComponent } from './createIcon.js';
import * as icons from './icons.js';

/** Every icon, for the Storybook gallery, tests and build checks only. Apps import icons by name. */
export const allIcons: readonly (readonly [string, IconComponent])[] = Object.entries(icons);
