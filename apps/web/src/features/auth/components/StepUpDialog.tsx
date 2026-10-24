import { STEP_UP_WINDOW_SEC, type StepUpRequest as StepUpBody } from '@nthstock/contracts';
import { Button, Dialog, Field, OtpInput } from '@nthstock/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { useSession } from '@/shared/hooks/useSession';
import { authFailure } from '../model/authError';
import { devOtpHint } from '../model/devOtp';
import { useStepUpStore } from '../store/stepUpStore';
import { strings } from '../strings';
import { FormError } from './AuthCard';
import { PIN_LENGTH } from './PinSetupStep';

/**
 * The shared step-up dialog (NSTOCK-0219), mounted once on a page with sensitive actions. It opens
 * when `useStepUp` meets a 403 STEP_UP_REQUIRED: the PIN (or an OTP to the user's mobile when no
 * PIN is set, or on request), plus an authenticator code when two-factor is on. On success the
 * action is retried; closing it cancels the action.
 */
export function StepUpDialog() {
  const request = useStepUpStore((state) => state.request);
  const settle = useStepUpStore((state) => state.settle);
  // Leaving the page cancels a pending step-up, so no action waits on a dialog that is gone.
  useEffect(() => () => settle('cancelled'), [settle]);
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) settle('cancelled');
      }}
      title={strings.stepUp.title}
      description={strings.stepUp.body}
    >
      {request ? (
        <StepUpForm
          totpRequired={request.totpRequired}
          onDone={(steppedUpUntil) => settle({ steppedUpUntil })}
        />
      ) : null}
    </Dialog>
  );
}

function StepUpForm({
  totpRequired,
  onDone,
}: {
  totpRequired: boolean;
  onDone: (steppedUpUntil: number) => void;
}) {
  const apiClient = useApiClient();
  const { session } = useSession();
  const user = session?.user;
  const needsCode = totpRequired || (user?.totpEnabled ?? false);
  const [method, setMethod] = useState<'PIN' | 'OTP'>(user?.pinSet ? 'PIN' : 'OTP');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [otpRequestId, setOtpRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const sendOtp = useMutation({
    mutationFn: () => apiClient.request('stepUpOtpRequest'),
    onSuccess: ({ requestId }) => {
      setOtpRequestId(requestId);
      setError(null);
    },
    onError: (failure) => {
      const { code: errorCode, details } = authFailure(failure);
      setError(
        errorCode === 'RATE_LIMITED'
          ? strings.errors.rateLimited(details.retryAfterSec)
          : errorCode === 'NETWORK'
            ? strings.errors.network
            : strings.errors.generic,
      );
    },
  });
  const stepUp = useMutation({
    mutationFn: (body: StepUpBody) => apiClient.request('stepUp', { body }),
  });

  const secretLength = method === 'PIN' ? PIN_LENGTH : 6;
  const ready = secret.length === secretLength && (!needsCode || code.length === 6);

  const submit = async () => {
    if (!ready || stepUp.isPending) return;
    const proof =
      method === 'PIN' ? { pin: secret } : { requestId: otpRequestId ?? '', otp: secret };
    try {
      await stepUp.mutateAsync({ ...proof, ...(needsCode ? { totpCode: code } : {}) });
      // On this device's clock, which may differ from the server's.
      onDone(Date.now() + STEP_UP_WINDOW_SEC * 1000);
    } catch (failure) {
      const { code: errorCode, details } = authFailure(failure);
      const message =
        errorCode === 'PIN_INVALID'
          ? strings.stepUp.wrongPin(details.attemptsLeft)
          : errorCode === 'PIN_LOCKED'
            ? strings.stepUp.pinLocked
            : errorCode === 'OTP_INVALID'
              ? strings.stepUp.wrongOtp
              : errorCode === 'OTP_EXPIRED'
                ? strings.stepUp.otpExpired
                : errorCode === 'TOTP_INVALID'
                  ? details.totpRequired && !needsCode
                    ? strings.stepUp.totpRequired
                    : strings.stepUp.wrongTotp
                  : errorCode === 'NETWORK'
                    ? strings.errors.network
                    : strings.errors.generic;
      setError(message);
      if (errorCode === 'PIN_LOCKED') setMethod('OTP');
      if (errorCode === 'OTP_EXPIRED') setOtpRequestId(null);
      setSecret('');
      setCode('');
      setAttempt((n) => n + 1);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const switchMethod = () => {
    setMethod((current) => (current === 'PIN' ? 'OTP' : 'PIN'));
    setSecret('');
    setError(null);
  };

  const waitingForOtp = method === 'OTP' && otpRequestId === null;
  return (
    <form className="grid gap-4" noValidate onSubmit={onSubmit}>
      {waitingForOtp ? (
        <Button block loading={sendOtp.isPending} onClick={() => sendOtp.mutate()}>
          {strings.stepUp.sendOtp}
        </Button>
      ) : (
        <Field label={method === 'PIN' ? strings.stepUp.pinLabel : strings.stepUp.otpLabel}>
          <OtpInput
            key={`${method}-${String(attempt)}`}
            value={secret}
            onChange={setSecret}
            length={secretLength}
            mask={method === 'PIN'}
            label={method === 'PIN' ? strings.stepUp.pinLabel : strings.stepUp.otpLabel}
            disabled={stepUp.isPending}
          />
        </Field>
      )}
      {method === 'OTP' && otpRequestId && user ? (
        <p className="text-label text-ink-muted">
          {strings.stepUp.otpSent(user.mobileMasked)}
          {devOtpHint ? ` ${strings.stepUp.devHint(devOtpHint)}` : ''}
        </p>
      ) : null}
      {needsCode && !waitingForOtp ? (
        <Field label={strings.stepUp.totpLabel}>
          <OtpInput
            key={`totp-${String(attempt)}`}
            value={code}
            onChange={setCode}
            label={strings.stepUp.totpLabel}
            disabled={stepUp.isPending}
          />
        </Field>
      ) : null}
      <FormError>{error}</FormError>
      {waitingForOtp ? null : (
        <Button type="submit" block loading={stepUp.isPending} disabled={!ready}>
          {strings.stepUp.confirm}
        </Button>
      )}
      {user?.pinSet ? (
        <Button variant="ghost" size="sm" onClick={switchMethod}>
          {method === 'PIN' ? strings.stepUp.useOtp : strings.stepUp.usePin}
        </Button>
      ) : null}
    </form>
  );
}
