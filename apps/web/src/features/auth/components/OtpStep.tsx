import { DEV_CAPTCHA_TOKEN, type OtpPurpose, type Session } from '@nthstock/contracts';
import { Button, Field, OtpInput } from '@nthstock/ui';
import { useId, useState, type FormEvent } from 'react';
import { useRequestOtp, useVerifyOtp } from '../hooks/useAuthMutations';
import { useCountdown } from '../hooks/useCountdown';
import { authFailure } from '../model/authError';
import { formatMobile } from '../model/mobile';
import { strings } from '../strings';
import { AuthCard } from './AuthCard';
import type { OtpSent } from './MobileStep';

export type OtpStepProps = {
  purpose: OtpPurpose;
  sent: OtpSent;
  /** The dev OTP to show in mock mode, or null. */
  devOtp: string | null;
  onVerified: (session: Session) => void;
  onChangeNumber: () => void;
};

type Challenge = { requestId: string; deadline: number; totalSec: number };

const challengeOf = (requestId: string, resendAfterSec: number): Challenge => ({
  requestId,
  deadline: Date.now() + resendAfterSec * 1000,
  totalSec: resendAfterSec,
});

/**
 * Step 2 (T-087): six boxes that submit themselves when full, a resend button that unlocks when
 * its countdown ends, "Change number", and the OTP error states (wrong, burnt, expired, CAPTCHA).
 * One field with auto-submit, so plain state rather than a React Hook Form form.
 */
export function OtpStep({ purpose, sent, devOtp, onVerified, onChangeNumber }: OtpStepProps) {
  const verifyOtp = useVerifyOtp();
  const requestOtp = useRequestOtp();
  const [challenge, setChallenge] = useState(() =>
    challengeOf(sent.requestId, sent.resendAfterSec),
  );
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Wrong too often or expired: only a new OTP helps. */
  const [burnt, setBurnt] = useState(false);
  const [captchaNeeded, setCaptchaNeeded] = useState(false);
  const [captchaDone, setCaptchaDone] = useState(false);
  /** Remounts the boxes (cleared, first box focused) after a failed attempt. */
  const [attempt, setAttempt] = useState(0);
  const captchaId = useId();
  const resendIn = useCountdown(challenge.deadline, challenge.totalSec);

  const retry = (message: string) => {
    setError(message);
    setOtp('');
    setAttempt((n) => n + 1);
  };

  const verify = async (code: string) => {
    if (verifyOtp.isPending || burnt) return;
    if (captchaNeeded && !captchaDone) {
      retry(strings.otp.captchaRequired);
      return;
    }
    setNotice(null);
    try {
      const session = await verifyOtp.mutateAsync({
        requestId: challenge.requestId,
        mobile: sent.mobile,
        otp: code,
        // The mock CAPTCHA: a real widget replaces this before launch (CLAUDE.md security baseline).
        ...(captchaNeeded && captchaDone ? { captchaToken: DEV_CAPTCHA_TOKEN } : {}),
      });
      onVerified(session);
    } catch (failure) {
      const { code: errorCode, details } = authFailure(failure);
      if (details.captchaRequired) setCaptchaNeeded(true);
      if (errorCode === 'OTP_INVALID' && details.attemptsLeft === 0) {
        setBurnt(true);
        retry(strings.otp.tooManyAttempts);
      } else if (errorCode === 'OTP_INVALID') {
        retry(strings.otp.wrong(details.attemptsLeft));
      } else if (errorCode === 'OTP_EXPIRED') {
        setBurnt(true);
        retry(strings.otp.expired);
      } else if (errorCode === 'CAPTCHA_REQUIRED') {
        setCaptchaDone(false);
        retry(strings.otp.captchaRequired);
      } else if (errorCode === 'RATE_LIMITED') {
        retry(strings.errors.rateLimited(details.retryAfterSec));
      } else {
        retry(errorCode === 'NETWORK' ? strings.errors.network : strings.errors.generic);
      }
    }
  };

  const resend = async () => {
    try {
      const next = await requestOtp.mutateAsync({ mobile: sent.mobile, purpose });
      setChallenge(challengeOf(next.requestId, next.resendAfterSec));
      setBurnt(false);
      setError(null);
      setNotice(strings.otp.resent);
      setOtp('');
      setAttempt((n) => n + 1);
    } catch (failure) {
      const { code, details } = authFailure(failure);
      const wait = details.retryAfterSec;
      if (code === 'RATE_LIMITED' && wait !== undefined) {
        setChallenge((current) => challengeOf(current.requestId, wait));
      }
      setError(
        code === 'RATE_LIMITED'
          ? strings.errors.rateLimited(details.retryAfterSec)
          : code === 'NETWORK'
            ? strings.errors.network
            : strings.errors.generic,
      );
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (otp.length === 6) void verify(otp);
  };

  return (
    <AuthCard title={strings.otp.title} description={strings.otp.sentTo(formatMobile(sent.mobile))}>
      <form className="grid gap-4" noValidate onSubmit={onSubmit}>
        <Field label={strings.otp.label} hideLabel error={error ?? undefined}>
          <OtpInput
            key={attempt}
            value={otp}
            onChange={setOtp}
            onComplete={(code) => void verify(code)}
            disabled={burnt || verifyOtp.isPending}
            label={strings.otp.label}
            autoFocus={!burnt}
          />
        </Field>
        {devOtp ? <p className="text-label text-ink-muted">{strings.otp.devHint(devOtp)}</p> : null}
        {captchaNeeded ? (
          <label
            htmlFor={captchaId}
            className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-label text-ink"
          >
            <input
              id={captchaId}
              type="checkbox"
              className="size-4 shrink-0 accent-brand"
              checked={captchaDone}
              onChange={(event) => setCaptchaDone(event.target.checked)}
            />
            {strings.otp.captchaLabel}
          </label>
        ) : null}
        {notice ? (
          <p role="status" className="text-label text-ink-muted">
            {notice}
          </p>
        ) : null}
        <Button
          type="submit"
          block
          loading={verifyOtp.isPending}
          disabled={burnt || otp.length !== 6}
        >
          {strings.otp.verify}
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onChangeNumber}>
            {strings.otp.changeNumber}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={resendIn > 0}
            loading={requestOtp.isPending}
            onClick={() => void resend()}
          >
            {resendIn > 0 ? strings.otp.resendIn(resendIn) : strings.otp.resend}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
