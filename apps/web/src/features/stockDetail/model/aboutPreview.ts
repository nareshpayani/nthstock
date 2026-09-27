/** Characters of the about text shown before "Read more". */
export const ABOUT_PREVIEW_CHARS = 220;

/**
 * The collapsed about text: `null` when the whole text fits, otherwise the text cut at the last
 * word boundary within `max` characters, with an ellipsis. Cutting the text itself (instead of
 * only clamping it visually) keeps what screen readers hear the same as what is on screen.
 */
export function aboutPreview(text: string, max: number = ABOUT_PREVIEW_CHARS): string | null {
  const trimmed = text.trim();
  if (trimmed.length <= max) return null;
  const cut = trimmed.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  const head = (space > max / 2 ? cut.slice(0, space) : trimmed.slice(0, max)).replace(
    /[\s,.;:–-]+$/,
    '',
  );
  return `${head}…`;
}
