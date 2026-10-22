import { Button } from '@nthstock/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useRequestOtp, useVerifyOtp } from '../hooks/useAuthMutations';
import { authFailure } from '../model/authError';
import { DEMO_INSTRUMENT, DEMO_MOBILE } from '../model/demo';
import { strings } from '../strings';

/**
 * "Try demo" (REQ-DEL-02): one tap logs in as the seeded demo user with the mock OTP and opens the
 * instrument page. Rendered only where the mock OTP is known (`devOtp` is not null).
 */
export function TryDemo({ devOtp }: { devOtp: string }) {
  const navigate = useNavigate();
  const requestOtp = useRequestOtp();
  const verifyOtp = useVerifyOtp();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setPending(true);
    setError(null);
    try {
      const sent = await requestOtp.mutateAsync({ mobile: DEMO_MOBILE, purpose: 'LOGIN' });
      await verifyOtp.mutateAsync({ requestId: sent.requestId, mobile: DEMO_MOBILE, otp: devOtp });
      await navigate({ to: '/stocks/$symbol', params: { symbol: DEMO_INSTRUMENT }, replace: true });
    } catch (failure) {
      setPending(false);
      setError(
        authFailure(failure).code === 'NETWORK' ? strings.errors.network : strings.errors.generic,
      );
    }
  };

  return (
    <div className="grid gap-2">
      <Button block disabled={pending} onClick={() => void start()}>
        {pending ? strings.demo.starting : strings.demo.label}
      </Button>
      {error ? (
        <p role="alert" className="text-label text-ink-muted">
          {error}
        </p>
      ) : null}
    </div>
  );
}
