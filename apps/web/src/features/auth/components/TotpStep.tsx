import { RecoveryCode, type Session } from '@nthstock/contracts';
import { Button, Field, Input, OtpInput } from '@nthstock/ui';
import { useState, type FormEvent } from 'react';
import { useVerifyTotp } from '../hooks/useAuthMutations';
import { authFailure } from '../model/authError';
import { strings } from '../strings';
import { AuthCard, FormError } from './AuthCard';

export type TotpStepProps = {
  /** From the 401 TOTP_REQUIRED that answered the PIN or OTP. */
  challengeId: string;
  onVerified: (session: Session) => void;
  /** The challenge ended (too many wrong codes, or expired): back to the first step. */
  onRestart: () => void;
};

/**
 * The login's code step for a user with two-factor on (NSTOCK-0220): six boxes that submit
 * themselves when full, or a recovery code when the phone is not at hand, with attempts left. After
 * five wrong codes the server ends the challenge and the user logs in again.
 */
export function TotpStep({ challengeId, onVerified, onRestart }: TotpStepProps) {
  const verifyTotp = useVerifyTotp();
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  /** Remounts the boxes (cleared, first box focused) after a failed attempt. */
  const [attempt, setAttempt] = useState(0);

  const verify = async (proof: { code: string } | { recoveryCode: string }) => {
    if (verifyTotp.isPending || ended) return;
    try {
      onVerified(await verifyTotp.mutateAsync({ challengeId, ...proof }));
    } catch (failure) {
      const { code: errorCode, details } = authFailure(failure);
      if (
        errorCode === 'UNAUTHORIZED' ||
        (errorCode === 'TOTP_INVALID' && details.attemptsLeft === 0)
      ) {
        setEnded(true);
        setError(strings.totp.ended);
        return;
      }
      setError(
        errorCode === 'TOTP_INVALID'
          ? strings.totp.wrong(details.attemptsLeft)
          : errorCode === 'RATE_LIMITED'
            ? strings.errors.rateLimited(details.retryAfterSec)
            : errorCode === 'NETWORK'
              ? strings.errors.network
              : strings.errors.generic,
      );
      setCode('');
      setAttempt((n) => n + 1);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'code') {
      if (code.length === 6) void verify({ code });
      return;
    }
    const parsed = RecoveryCode.safeParse(recovery);
    if (!parsed.success) {
      setError(strings.totp.recoveryInvalid);
      return;
    }
    void verify({ recoveryCode: parsed.data });
  };

  const switchMode = () => {
    setMode((current) => (current === 'code' ? 'recovery' : 'code'));
    setError(null);
    setCode('');
    setRecovery('');
  };

  const recoveryMode = mode === 'recovery';
  return (
    <AuthCard
      title={recoveryMode ? strings.totp.recoveryTitle : strings.totp.title}
      description={recoveryMode ? strings.totp.recoveryBody : strings.totp.body}
    >
      <form className="grid gap-4" noValidate onSubmit={onSubmit}>
        {recoveryMode ? (
          <Field
            label={strings.totp.recoveryLabel}
            error={ended ? undefined : (error ?? undefined)}
          >
            <Input
              value={recovery}
              onChange={(event) => setRecovery(event.target.value)}
              placeholder={strings.totp.recoveryPlaceholder}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={ended}
              className="font-mono uppercase"
            />
          </Field>
        ) : (
          <Field
            label={strings.totp.label}
            hideLabel
            error={ended ? undefined : (error ?? undefined)}
          >
            <OtpInput
              key={attempt}
              value={code}
              onChange={setCode}
              onComplete={(full) => void verify({ code: full })}
              disabled={ended || verifyTotp.isPending}
              label={strings.totp.label}
              autoFocus={!ended}
            />
          </Field>
        )}
        {ended ? <FormError>{strings.totp.ended}</FormError> : null}
        {ended ? (
          <Button block onClick={onRestart}>
            {strings.totp.startAgain}
          </Button>
        ) : (
          <Button
            type="submit"
            block
            loading={verifyTotp.isPending}
            disabled={recoveryMode ? recovery.trim() === '' : code.length !== 6}
          >
            {strings.totp.verify}
          </Button>
        )}
        {ended ? null : (
          <Button variant="ghost" size="sm" onClick={switchMode}>
            {recoveryMode ? strings.totp.useCode : strings.totp.useRecovery}
          </Button>
        )}
      </form>
    </AuthCard>
  );
}
