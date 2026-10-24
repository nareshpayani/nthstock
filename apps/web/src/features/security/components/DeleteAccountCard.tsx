import { ACCOUNT_PURGE_AFTER_DAYS } from '@nthstock/contracts';
import { Button, Dialog, Field, Input, useToast } from '@nthstock/ui';
import { useState, type FormEvent } from 'react';
import { StepUpCancelledError } from '@/features/auth';
import { Card } from '@/shared/components/Card';
import { useDeleteAccount } from '../hooks/useDeleteAccount';
import { describeTwoFactorError } from '../model/twoFactorError';
import { strings } from '../strings';

const CONFIRM_WORD = 'DELETE';

/**
 * The delete account card (NSTOCK-0234, DPDP Act 2023): a danger dialog that says what is deleted
 * and when, needs DELETE typed, then a step-up. The app then leaves for /login with a notice.
 */
export function DeleteAccountCard() {
  const toast = useToast();
  const deleteAccount = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const close = () => {
    setOpen(false);
    setTyped('');
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (typed !== CONFIRM_WORD || deleteAccount.isPending) return;
    deleteAccount.mutate(undefined, {
      onError: (failure) => {
        if (failure instanceof StepUpCancelledError) return;
        toast.show({ title: describeTwoFactorError(failure), tone: 'error' });
      },
    });
  };

  return (
    <Card title={strings.deleteAccount.title} className="border-down/40">
      <div className="grid gap-4">
        <p className="max-w-prose text-body text-ink-muted">{strings.deleteAccount.body}</p>
        <div>
          <Button variant="secondary" className="text-down" onClick={() => setOpen(true)}>
            {strings.deleteAccount.open}
          </Button>
        </div>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={strings.deleteAccount.dialogTitle}
        description={strings.deleteAccount.dialogBody(ACCOUNT_PURGE_AFTER_DAYS)}
      >
        <form className="grid gap-4" noValidate onSubmit={onSubmit}>
          <div className="grid gap-2">
            <h3 className="text-body font-semibold text-ink">{strings.deleteAccount.whatGoes}</h3>
            <ul className="list-disc space-y-1 pl-5 text-body text-ink-muted">
              {strings.deleteAccount.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="text-label text-ink-muted">{strings.deleteAccount.kept}</p>
          </div>
          <Field label={strings.deleteAccount.typeLabel}>
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              {strings.deleteAccount.cancel}
            </Button>
            <Button
              type="submit"
              variant="danger"
              loading={deleteAccount.isPending}
              disabled={typed !== CONFIRM_WORD}
            >
              {strings.deleteAccount.confirm}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
