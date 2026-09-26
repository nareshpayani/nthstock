import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { documentTitle, useDocumentTitle } from './useDocumentTitle';

function Page({ title }: { title: string }) {
  useDocumentTitle(title);
  return null;
}

afterEach(() => {
  document.title = '';
});

describe('useDocumentTitle (T-105)', () => {
  it('sets the title while mounted, follows changes and restores the previous one', () => {
    document.title = 'nthstock';
    const view = render(<Page title="Infosys Ltd (INFY)" />);
    expect(document.title).toBe('Infosys Ltd (INFY) · nthstock');
    view.rerender(<Page title="Tata Consultancy Services Ltd (TCS)" />);
    expect(document.title).toBe(documentTitle('Tata Consultancy Services Ltd (TCS)'));
    view.unmount();
    expect(document.title).toBe('nthstock');
  });
});
