import type { TotpEnrolResponse } from '@nthstock/contracts';
import { Button, Dialog, Field, IconCheck, OtpInput } from '@nthstock/ui';
import { groupSetupKey } from '@nthstock/utils';
import { useState, type FormEvent } from 'react';
import { describeTwoFactorError } from '../model/twoFactorError';
import { strings } from '../strings';
import type { useTwoFactor } from '../hooks/useTwoFactor';
import { QrCode } from './QrCode';
import { RecoveryCodes } from './RecoveryCodes';

type Step =
  | { kind: 'scan'; enrol: TotpEnrolResponse }
  | { kind: 'confirm'; enrol: TotpEnrolResponse }
  | { kind: 'codes'; codes: string[] };

export type TotpSetupDialogProps = {
  /** The enrolment the card started (after any step-up); null closes the dialog. */
  enrol: TotpEnrolResponse | null;
  confirm: ReturnType<typeof useTwoFactor>['confirm'];
  mobileMasked: string;
  onClose: () => void;
  /** Two-factor is on and the codes are saved. */
  onDone: () => void;
};

/**
 * The turn-on wizard (NSTOCK-0221): scan the QR code (or copy the setup key, or open the
 * `otpauth://` link on a phone), confirm with the app's code, then save the recovery codes.
 */
export function TotpSetupDialog({
  enrol,
  confirm,
  mobileMasked,
  onClose,
  onDone,
}: TotpSetupDialogProps) {
  return (
    <Dialog
      open={enrol !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={strings.setup.title}
    >
      {enrol ? (
        <SetupSteps
          key={enrol.setupKey}
          enrol={enrol}
          confirm={confirm}
          mobileMasked={mobileMasked}
          onDone={onDone}
        />
      ) : null}
    </Dialog>
  );
}

function SetupSteps({
  enrol,
  confirm,
  mobileMasked,
  onDone,
}: Omit<TotpSetupDialogProps, 'enrol' | 'onClose'> & { enrol: TotpEnrolResponse }) {
  const [step, setStep] = useState<Step>({ kind: 'scan', enrol });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const submit = (value: string) => {
    if (confirm.isPending) return;
    confirm.mutate(value, {
      onSuccess: ({ codes }) => setStep({ kind: 'codes', codes }),
      onError: (failure) => {
        setError(describeTwoFactorError(failure));
        setCode('');
        setAttempt((n) => n + 1);
      },
    });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (code.length === 6) submit(code);
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(enrol.setupKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (step.kind === 'codes') {
    return (
      <section className="grid gap-3" aria-label={strings.setup.codesTitle}>
        <h3 className="text-body font-semibold text-ink">{strings.setup.codesTitle}</h3>
        <RecoveryCodes codes={step.codes} mobileMasked={mobileMasked} onDone={onDone} />
      </section>
    );
  }

  if (step.kind === 'confirm') {
    return (
      <form className="grid gap-4" noValidate onSubmit={onSubmit}>
        <h3 className="text-body font-semibold text-ink">{strings.setup.confirmTitle}</h3>
        <Field label={strings.setup.codeLabel} error={error ?? undefined}>
          <OtpInput
            key={attempt}
            value={code}
            onChange={setCode}
            onComplete={submit}
            label={strings.setup.codeLabel}
            disabled={confirm.isPending}
          />
        </Field>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={() => setStep({ kind: 'scan', enrol })}>
            {strings.setup.back}
          </Button>
          <Button type="submit" loading={confirm.isPending} disabled={code.length !== 6}>
            {strings.setup.confirm}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="text-body font-semibold text-ink">{strings.setup.scanTitle}</h3>
        <p className="text-label text-ink-muted">{strings.setup.scanBody}</p>
      </div>
      <div className="flex justify-center">
        <QrCode text={enrol.otpauthUri} />
      </div>
      <div className="grid gap-1">
        <span className="text-label text-ink-muted">{strings.setup.setupKey}</span>
        <div className="flex flex-wrap items-center gap-2">
          <code
            data-testid="totp-setup-key"
            className="rounded-sm bg-canvas px-2 py-1 font-mono text-body text-ink select-all"
          >
            {groupSetupKey(enrol.setupKey)}
          </code>
          <Button
            variant="secondary"
            size="sm"
            icon={copied ? <IconCheck size={16} /> : undefined}
            onClick={() => void copyKey()}
          >
            {copied ? strings.setup.copied : strings.setup.copyKey}
          </Button>
        </div>
      </div>
      {/* The contract holds this to otpauth://totp/…; it opens the phone's authenticator app. */}
      <a href={enrol.otpauthUri} className="text-label text-brand underline md:hidden">
        {strings.setup.openApp}
      </a>
      <Button block onClick={() => setStep({ kind: 'confirm', enrol })}>
        {strings.setup.next}
      </Button>
    </div>
  );
}
