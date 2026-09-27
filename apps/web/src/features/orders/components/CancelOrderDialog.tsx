import type { Order } from '@nthstock/contracts';
import { Button, Dialog } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useRef } from 'react';
import { strings } from '../strings';

export type CancelOrderDialogProps = {
  order: Order | null;
  cancelling: boolean;
  onKeep: () => void;
  onConfirm: (order: Order) => void;
};

/** "Cancel this order?" (T-145): what is cancelled, then Keep order or Cancel order. */
export function CancelOrderDialog({
  order,
  cancelling,
  onKeep,
  onConfirm,
}: CancelOrderDialogProps) {
  const keep = useRef<HTMLButtonElement>(null);
  const summary = order
    ? `${strings.sides[order.side]} ${String(order.qty - order.filledQty)} ${order.symbol} · ${
        order.price === null ? strings.atMarket : formatInr(order.price)
      } · ${strings.products[order.product]}`
    : '';
  return (
    <Dialog
      open={order !== null}
      onOpenChange={(open) => {
        if (!open && !cancelling) onKeep();
      }}
      title={strings.cancelDialog.title}
      description={order ? strings.cancelDialog.body(summary) : undefined}
      initialFocus={keep}
      footer={
        <>
          <Button ref={keep} variant="secondary" onClick={onKeep} disabled={cancelling}>
            {strings.cancelDialog.keep}
          </Button>
          <Button
            variant="danger"
            loading={cancelling}
            onClick={() => {
              if (order) onConfirm(order);
            }}
          >
            {strings.cancelDialog.confirm}
          </Button>
        </>
      }
    />
  );
}
