import type { PriceAlert } from '@nthstock/contracts';
import { EmptyState, IconBell, IconButton, IconTrash, cn } from '@nthstock/ui';
import { formatInr, formatIstTime } from '@nthstock/utils';
import { strings } from '../strings';

export type AlertListProps = {
  items: readonly PriceAlert[];
  onRemove: (alert: PriceAlert) => void;
  /** Ids being removed, so their buttons wait. */
  removing?: ReadonlySet<string>;
  /** One stock's dialog leaves out the symbol column. */
  showSymbol?: boolean;
};

const STATUS_CLASS = {
  ACTIVE: 'bg-brand-soft text-brand',
  TRIGGERED: 'bg-up-soft text-up',
  CANCELLED: 'bg-canvas text-ink-muted',
} as const;

/** Price alerts with their rule and status; an active alert has a Remove button. */
export function AlertList({ items, onRemove, removing, showSymbol = true }: AlertListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconBell size={24} />}
        title={strings.alerts.empty}
        description={strings.alerts.emptyBody}
      />
    );
  }
  return (
    <ul className="grid divide-y divide-line">
      {items.map((alert) => (
        <li key={alert.id} className="flex items-center gap-3 py-3 text-body">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-ink">
              {showSymbol ? (
                <span className="mr-2 font-mono font-medium">{alert.symbol}</span>
              ) : null}
              {strings.alerts.rule(alert.condition, formatInr(alert.price))}
            </span>
            {alert.note ? <span className="text-ink-muted">{alert.note}</span> : null}
            {alert.status === 'TRIGGERED' && alert.triggeredAt && alert.triggeredLtp !== null ? (
              <span className="text-label text-ink-muted">
                {strings.alerts.firedAt(
                  formatInr(alert.triggeredLtp),
                  formatIstTime(new Date(alert.triggeredAt)),
                )}
              </span>
            ) : null}
          </div>
          <span
            className={cn(
              'rounded-pill px-2 py-0.5 text-label font-medium',
              STATUS_CLASS[alert.status],
            )}
          >
            {
              {
                ACTIVE: strings.alerts.active,
                TRIGGERED: strings.alerts.triggered,
                CANCELLED: strings.alerts.cancelled,
              }[alert.status]
            }
          </span>
          {alert.status === 'ACTIVE' ? (
            <IconButton
              size="sm"
              label={strings.alerts.remove(alert.symbol)}
              icon={<IconTrash size={16} />}
              disabled={removing?.has(alert.id) ?? false}
              onClick={() => onRemove(alert)}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
