import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { allIcons } from './allIcons.js';
import { IconSearch } from './icons.js';
import { Logo } from './Logo.js';

describe('icons', () => {
  it('exports a uniquely named, decorative-by-default icon set', () => {
    expect(allIcons.length).toBeGreaterThanOrEqual(25);
    const names = allIcons.map(([, Icon]) => Icon.iconName);
    expect(new Set(names).size).toBe(names.length);
    for (const [exportName, Icon] of allIcons) {
      expect(exportName).toMatch(/^Icon[A-Z]/);
      const { container, unmount } = render(<Icon />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('data-icon', Icon.iconName);
      unmount();
    }
  });

  it('becomes an image with a title when given one', () => {
    render(<IconSearch title="Search stocks" size={24} />);
    const svg = screen.getByRole('img', { name: 'Search stocks' });
    expect(svg).toHaveAttribute('width', '24');
  });
});

describe('Logo', () => {
  it('has one accessible name with or without the wordmark', () => {
    const { rerender } = render(<Logo />);
    expect(screen.getByRole('img', { name: 'nthstock' })).toHaveTextContent('nthstock');
    rerender(<Logo withWordmark={false} />);
    expect(screen.getByRole('img', { name: 'nthstock' })).not.toHaveTextContent('stock');
  });
});

describe('icon fingerprints', () => {
  it('every icon draws a path (apps/web checkBuild uses its d string to detect bundled icons)', () => {
    for (const [, Icon] of allIcons) {
      const { container, unmount } = render(<Icon />);
      expect(container.querySelector('path')?.getAttribute('d')).toBeTruthy();
      unmount();
    }
  });
});
