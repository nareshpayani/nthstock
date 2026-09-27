import { describe, expect, it } from 'vitest';
import { ABOUT_PREVIEW_CHARS, aboutPreview } from './aboutPreview';

describe('aboutPreview', () => {
  it('returns null when the text fits', () => {
    expect(aboutPreview('Short text.')).toBeNull();
    expect(aboutPreview('x'.repeat(ABOUT_PREVIEW_CHARS))).toBeNull();
  });

  it('cuts at a word boundary and adds an ellipsis', () => {
    expect(aboutPreview('one two three four', 10)).toBe('one two…');
    expect(aboutPreview('Alpha beta, gamma delta', 12)).toBe('Alpha beta…');
  });

  it('cuts mid-word only when there is no usable space', () => {
    expect(aboutPreview('abcdefghijklmnop qr', 8)).toBe('abcdefgh…');
  });

  it('never exceeds the limit plus the ellipsis', () => {
    const text = 'word '.repeat(200);
    const preview = aboutPreview(text) ?? '';
    expect(preview.length).toBeLessThanOrEqual(ABOUT_PREVIEW_CHARS + 1);
    expect(preview.endsWith('…')).toBe(true);
  });
});
