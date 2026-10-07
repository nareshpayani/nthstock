import { Button, Field, OtpInput } from '@nthstock/ui';
import { useState, type FormEvent } from 'react';
import { useVerifyPin } from '../hooks/useAuthMutations';
import { authFailure } from '../model/authError';
import { strings } from '../strings';
import type { TrustedDeviceHint } from '../store/trustedDevice';
import { AuthCard } from './AuthCard';
import { PIN_LENGTH } from './PinSetupStep';

export type PinEntryStepProps = {
  device: TrustedDeviceHint;
  onSuccess: () => void;
  /** 5 wrong PINs: the account's PIN is locked until an OTP is verified. */
  onLocked: () => void;
  /** The server no longer trusts this browser for PIN login. */
  onUntrusted: () => void;
  onUseOtp: () => void;
};

/** PIN login on a trusted browser (T-088). Submits itself once four digits are in. */
export function PinEntryStep({
  device,
  onSuccess,
  onLocked,
  onUntrusted,
  onUseOtp,
}: PinEntryStepProps) {
  const verifyPin = useVerifyPin();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const verify = async (code: string) => {
    if (verifyPin.isPending) return;
    try {
      await verifyPin.mutateAsync(code);
      onSuccess();
    } catch (failure) {
      const { code: errorCode, details } = authFailure(failure);
      if (errorCode === 'PIN_LOCKED') {
        onLocked();
        return;
      }
      if (errorCode === 'UNAUTHORIZED') {
        onUntrusted();
        return;
      }
      setError(
        errorCode === 'PIN_INVALID'
          ? strings.pinEntry.wrong(details.attemptsLeft)
          : errorCode === 'RATE_LIMITED'
            ? strings.errors.rateLimited(details.retryAfterSec)
            : errorCode === 'NETWORK'
              ? strings.errors.network
              : strings.errors.generic,
      );
      setPin('');
      setAttempt((n) => n + 1);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (pin.length === PIN_LENGTH) void verify(pin);
  };

  return (
    <AuthCard
      title={strings.pinEntry.title(device.name)}
      description={strings.pinEntry.body(device.mobileMasked)}
    >
      <form className="grid gap-4" noValidate onSubmit={onSubmit}>
        <Field label={strings.pinEntry.label} hideLabel error={error ?? undefined}>
          <OtpInput
            key={attempt}
            value={pin}
            onChange={setPin}
            onComplete={(code) => void verify(code)}
            length={PIN_LENGTH}
            mask
            // eslint-disable-next-line jsx-a11y-x/no-autofocus -- single-purpose login step; focus lands on its first input
            autoFocus
            disabled={verifyPin.isPending}
            label={strings.pinEntry.label}
          />
        </Field>
        <Button
          type="submit"
          block
          loading={verifyPin.isPending}
          disabled={pin.length !== PIN_LENGTH}
        >
          {strings.pinEntry.submit}
        </Button>
        <Button variant="ghost" block onClick={onUseOtp}>
          {strings.pinEntry.useOtp}
        </Button>
      </form>
    </AuthCard>
  );
}

export type PinLockedProps = { onUnlock: () => void };

/** Shown after the 5th wrong PIN: only a verified OTP lifts the lock. */
export function PinLocked({ onUnlock }: PinLockedProps) {
  return (
    <AuthCard title={strings.locked.title} description={strings.locked.body} focusHeading>
      <Button block onClick={onUnlock}>
        {strings.locked.unlock}
      </Button>
    </AuthCard>
  );
}
