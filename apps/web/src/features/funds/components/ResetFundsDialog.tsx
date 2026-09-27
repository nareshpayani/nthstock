import { ResetRequest } from '@nthstock/contracts';
import { Button, Dialog, Field, Input } from '@nthstock/ui';
import { useId, useRef, useState, type ReactNode } from 'react';
import { strings } from '../strings';

export type ResetFundsDialogProps = {
  /** The button that opens the dialog; focus returns to it on close. */
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resetting: boolean;
  onConfirm: () => void;
};

/**
 * The reset paper balance danger dialog (T-160): says what is cleared, and enables Reset only
 * once RESET is typed exactly (the contract's `ResetRequest`). Esc, the close button and Keep my
 * account leave everything as it was; focus goes back to the button that opened it.
 */
export function ResetFundsDialog({
  trigger,
  open,
  onOpenChange,
  resetting,
  onConfirm,
}: ResetFundsDialogProps) {
  const [typed, setTyped] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const confirmed = ResetRequest.safeParse({ confirm: typed }).success;

  const change = (next: boolean) => {
    if (!next) setTyped('');
    onOpenChange(next);
  };

  return (
    <Dialog
      trigger={trigger}
      open={open}
      onOpenChange={change}
      title={strings.reset.title}
      description={strings.reset.description}
      initialFocus={input}
      footer={
        <>
          <Button variant="secondary" onClick={() => change(false)} disabled={resetting}>
            {strings.reset.keep}
          </Button>
          <Button
            variant="danger"
            disabled={!confirmed}
            loading={resetting}
            onClick={() => {
              if (confirmed) onConfirm();
            }}
          >
            {strings.reset.confirm}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmed && !resetting) onConfirm();
        }}
      >
        <div className="grid gap-2 rounded-md bg-down-soft p-3">
          <p id={listId} className="text-body font-semibold text-ink">
            {strings.reset.clears}
          </p>
          <ul aria-labelledby={listId} className="grid list-disc gap-1 pl-5 text-body text-ink">
            {strings.reset.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <Field label={strings.reset.field} hint={strings.reset.hint}>
          <Input
            ref={input}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </Field>
      </form>
    </Dialog>
  );
}
