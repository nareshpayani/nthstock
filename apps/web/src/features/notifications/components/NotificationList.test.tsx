import type { Notification } from '@nthstock/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { NotificationList } from './NotificationList';

const base: Notification = {
  id: 'ntf_a',
  kind: 'PRICE_ALERT',
  title: 'INFY crossed above ₹1,530.00',
  body: 'Now ₹1,531.20',
  symbol: 'INFY',
  exchange: 'NSE',
  at: '2026-10-25T04:00:00.000Z',
  read: false,
};

describe('NotificationList (NSTOCK-0462)', () => {
  it('gives an unread row a pinging dot and the "Unread" text, and a read row neither', async () => {
    const items: Notification[] = [
      base,
      { ...base, id: 'ntf_b', title: 'TCS crossed below ₹3,900.00', read: true },
    ];
    const { container } = renderWithProviders(
      <NotificationList items={items} onNavigate={() => undefined} />,
    );
    const [unreadRow, readRow] = (await screen.findAllByRole('listitem')) as [
      HTMLElement,
      HTMLElement,
    ];
    expect(unreadRow.querySelectorAll('[data-part="ripple"]')).toHaveLength(1);
    expect(within(unreadRow).getByText('Unread')).toBeInTheDocument();
    expect(readRow.querySelector('[data-part="ripple"]')).toBeNull();
    expect(within(readRow).queryByText('Unread')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-part="ripple"]')).toHaveLength(1);
  });
});
