import { createApiClient, type FetchLike } from '@nthstock/apiClient';
import { OTP_RESEND_AFTER_SEC } from '@nthstock/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientContext } from '@/shared/lib/apiClientContext';
import { OtpStep } from './OtpStep';

const T0 = Date.parse('2026-09-25T04:00:00.000Z');

function renderOtpStep() {
  const requests: string[] = [];
  const fetch: FetchLike = (url) => {
    requests.push(url);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          requestId: `otp_${String(requests.length + 1)}`,
          resendAfterSec: OTP_RESEND_AFTER_SEC,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiClientContext.Provider value={createApiClient({ baseUrl: 'http://otp.test', fetch })}>
        <OtpStep
          purpose="LOGIN"
          sent={{
            mobile: '9876543210',
            requestId: 'otp_1',
            resendAfterSec: OTP_RESEND_AFTER_SEC,
            expiresAt: new Date(T0 + 300_000).toISOString(),
          }}
          devOtp={null}
          onVerified={vi.fn()}
          onChangeNumber={vi.fn()}
        />
      </ApiClientContext.Provider>
    </QueryClientProvider>,
  );
  return { requests };
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('OTP resend countdown (T-087)', () => {
  it('stays disabled until the countdown ends, then sends a new OTP and restarts', async () => {
    const { requests } = renderOtpStep();
    expect(screen.getByRole('button', { name: 'Resend OTP in 0:30' })).toBeDisabled();

    act(() => vi.advanceTimersByTime(29_000));
    expect(screen.getByRole('button', { name: 'Resend OTP in 0:01' })).toBeDisabled();

    act(() => vi.advanceTimersByTime(1_000));
    const resend = screen.getByRole('button', { name: 'Resend OTP' });
    expect(resend).toBeEnabled();

    fireEvent.click(resend);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(requests).toEqual(['http://otp.test/v1/auth/otp/request']);
    expect(screen.getByRole('status')).toHaveTextContent('We sent a new OTP.');
    expect(screen.getByRole('button', { name: 'Resend OTP in 0:30' })).toBeDisabled();
  });

  it('hides the dev OTP hint when there is none', () => {
    renderOtpStep();
    expect(screen.queryByText(/Mock mode/)).not.toBeInTheDocument();
  });
});
