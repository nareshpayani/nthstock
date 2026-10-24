import type { Notification } from '@nthstock/contracts';
import { EmptyState, IconBell, IconChart, IconCheck, cn } from '@nthstock/ui';
import { formatIstTime } from '@nthstock/utils';
import { Link } from '@tanstack/react-router';
import { strings } from '../strings';

const ICONS = { PRICE_ALERT: IconBell, ORDER_FILLED: IconCheck, TRAILING_STOP: IconChart };

export type NotificationListProps = {
  items: readonly Notification[];
  /** Following a notification's stock link closes the centre. */
  onNavigate: () => void;
};

/** The centre's list, newest first; unread rows carry a dot and an "Unread" label. */
export function NotificationList({ items, onNavigate }: NotificationListProps) {
  if (items.length === 0) {
    return <EmptyState title={strings.centre.empty} description={strings.centre.emptyBody} />;
  }
  return (
    <ul className="grid divide-y divide-line">
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        const text = (
          <>
            <span className="font-medium text-ink">{item.title}</span>
            {item.body ? <span className="text-ink-muted">{item.body}</span> : null}
            <span className="text-label text-ink-muted">{formatIstTime(new Date(item.at))}</span>
          </>
        );
        return (
          <li key={item.id} className="flex gap-3 py-3">
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-pill',
                item.read ? 'bg-canvas text-ink-muted' : 'bg-brand-soft text-brand',
              )}
            >
              <Icon size={16} />
            </span>
            {item.symbol ? (
              <Link
                to="/stocks/$symbol"
                params={{ symbol: item.symbol }}
                onClick={onNavigate}
                className="grid min-w-0 flex-1 gap-0.5 rounded-md text-body hover:bg-canvas"
              >
                {text}
              </Link>
            ) : (
              <p className="grid min-w-0 flex-1 gap-0.5 text-body">{text}</p>
            )}
            {item.read ? null : (
              <span className="mt-2 flex items-start">
                <span aria-hidden="true" className="size-2 rounded-pill bg-brand" />
                <span className="sr-only">{strings.centre.unread}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
