import { Button, Dialog, Field, OtpInput } from '@nthstock/ui';
import { useState, type FormEvent } from 'react';
import type { useTwoFactor } from '../hooks/useTwoFactor';
import { describeTwoFactorError } from '../model/twoFactorError';
import { strings } from '../strings';
import { RecoveryCodes } from './RecoveryCodes';

export type RegenerateCodesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  regenerate: ReturnType<typeof useTwoFactor>['regenerate'];
  mobileMasked: string;
};

/** New recovery codes (NSTOCK-0221): a current code replaces every unused one. */
export function RegenerateCodesDialog({
  open,
  onOpenChange,
  regenerate,
  mobileMasked,
}: RegenerateCodesDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={strings.regenerate.title}
      description={strings.regenerate.body}
    >
      {open ? (
        <RegenerateForm
          regenerate={regenerate}
          mobileMasked={mobileMasked}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function RegenerateForm({
  regenerate,
  mobileMasked,
  onClose,
}: Pick<RegenerateCodesDialogProps, 'regenerate' | 'mobileMasked'> & { onClose: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  if (codes) return <RecoveryCodes codes={codes} mobileMasked={mobileMasked} onDone={onClose} />;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== 6) return;
    regenerate.mutate(code, {
      onSuccess: (result) => setCodes(result.codes),
      onError: (failure) => {
        setError(describeTwoFactorError(failure));
        setCode('');
      },
    });
  };

  return (
    <form className="grid gap-4" noValidate onSubmit={onSubmit}>
      <Field label={strings.regenerate.codeLabel} error={error ?? undefined}>
        <OtpInput value={code} onChange={setCode} label={strings.regenerate.codeLabel} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {strings.regenerate.cancel}
        </Button>
        <Button type="submit" loading={regenerate.isPending} disabled={code.length !== 6}>
          {strings.regenerate.confirm}
        </Button>
      </div>
    </form>
  );
}
