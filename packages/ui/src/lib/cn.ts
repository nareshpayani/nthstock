import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge taught about nthstock's token names, so `text-body` (a size) and `text-ink`
 * (a colour) are not treated as conflicting classes.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        'brand',
        'brand-soft',
        'marigold',
        'marigold-soft',
        'up',
        'up-soft',
        'down',
        'down-soft',
        'ink',
        'ink-muted',
        'canvas',
        'line',
        'surface',
      ],
      text: ['display', 'title', 'lg', 'body', 'label'],
      radius: ['sm', 'md', 'lg', 'pill'],
      shadow: ['raised', 'overlay'],
    },
  },
});

export type ClassValue = string | false | null | undefined;

/** Joins class names, dropping falsy values, and resolves Tailwind conflicts (last one wins). */
export function cn(...classes: ClassValue[]): string {
  return twMerge(classes.filter(Boolean).join(' '));
}
