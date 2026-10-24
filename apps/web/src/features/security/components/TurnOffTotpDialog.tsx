import { RecoveryCode } from '@nthstock/contracts';
import { Button, Dialog, Field, Input, OtpInput } from '@nthstock/ui';
import { useState, type FormEvent } from 'react';
import type { useTwoFactor } from '../hooks/useTwoFactor';
import { describeTwoFactorError } from '../model/twoFactorError';
import { strings } from '../strings';

export type TurnOffTotpDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disable: ReturnType<typeof useTwoFactor>['disable'];
  onDone: () => void;
};

/** Turning two-factor off (NSTOCK-0221) needs a current code, or a recovery code. */
export function TurnOffTotpDialog({ open, onOpenChange, disable, onDone }: TurnOffTotpDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={strings.turnOff.title}
      description={strings.turnOff.body}
    >
      {open ? (
        <TurnOffForm disable={disable} onDone={onDone} onCancel={() => onOpenChange(false)} />
      ) : null}
    </Dialog>
  );
}

function TurnOffForm({
  disable,
  onDone,
  onCancel,
}: Pick<TurnOffTotpDialogProps, 'disable' | 'onDone'> & { onCancel: () => void }) {
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    let proof;
    if (mode === 'code') {
      if (code.length !== 6) return;
      proof = { code };
    } else {
      const parsed = RecoveryCode.safeParse(recovery);
      if (!parsed.success) {
        setError(strings.errors.recoveryInvalid);
        return;
      }
      proof = { recoveryCode: parsed.data };
    }
    disable.mutate(proof, {
      onSuccess: onDone,
      onError: (failure) => {
        setError(describeTwoFactorError(failure));
        setCode('');
      },
    });
  };

  return (
    <form className="grid gap-4" noValidate onSubmit={onSubmit}>
      {mode === 'code' ? (
        <Field label={strings.turnOff.codeLabel} error={error ?? undefined}>
          <OtpInput value={code} onChange={setCode} label={strings.turnOff.codeLabel} />
        </Field>
      ) : (
        <Field label={strings.turnOff.recoveryLabel} error={error ?? undefined}>
          <Input
            value={recovery}
            onChange={(event) => setRecovery(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="font-mono uppercase"
          />
        </Field>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setMode((current) => (current === 'code' ? 'recovery' : 'code'));
          setError(null);
        }}
      >
        {mode === 'code' ? strings.turnOff.useRecovery : strings.turnOff.useCode}
      </Button>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {strings.turnOff.cancel}
        </Button>
        <Button
          type="submit"
          variant="danger"
          loading={disable.isPending}
          disabled={mode === 'code' ? code.length !== 6 : recovery.trim() === ''}
        >
          {strings.turnOff.confirm}
        </Button>
      </div>
    </form>
  );
}
