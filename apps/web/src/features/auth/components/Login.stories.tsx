import { DEV_OTP, OTP_RESEND_AFTER_SEC } from '@nthstock/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { StoryAuthProviders } from '@/mocks/storyAuth';
import { LoginPage } from './LoginPage';
import { OtpStep } from './OtpStep';
import { PinEntryStep, PinLocked } from './PinEntryStep';
import { PinSetupStep } from './PinSetupStep';

/** The login card frame, as LoginPage draws it, for stories of a single step. */
function Card({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-4">
      <div className="grid w-full max-w-sm gap-6 rounded-lg border border-line bg-surface p-6">
        {children}
      </div>
    </main>
  );
}

type Step = 'mobile' | 'otp' | 'pinSetup' | 'pinEntry' | 'locked';

const noop = () => undefined;

function Demo({ step }: { step: Step }) {
  let content: ReactNode;
  switch (step) {
    case 'mobile':
      // The whole page: no trusted-device hint in a fresh story, so it opens on the mobile step.
      return (
        <StoryAuthProviders>
          <LoginPage devOtp={DEV_OTP} />
        </StoryAuthProviders>
      );
    case 'otp':
      content = (
        <OtpStep
          purpose="LOGIN"
          sent={{
            mobile: '9876543210',
            requestId: 'otp_story',
            resendAfterSec: OTP_RESEND_AFTER_SEC,
            expiresAt: '2026-09-26T06:05:00.000Z',
          }}
          devOtp={DEV_OTP}
          onVerified={noop}
          onChangeNumber={noop}
        />
      );
      break;
    case 'pinSetup':
      content = <PinSetupStep onDone={noop} />;
      break;
    case 'pinEntry':
      content = (
        <PinEntryStep
          device={{ name: 'Asha Rao', mobileMasked: '******3210' }}
          onSuccess={noop}
          onLocked={noop}
          onUntrusted={noop}
          onUseOtp={noop}
        />
      );
      break;
    case 'locked':
      content = <PinLocked onUnlock={noop} />;
      break;
  }
  return (
    <StoryAuthProviders>
      <Card>{content}</Card>
    </StoryAuthProviders>
  );
}

const meta = {
  title: 'Auth/Login',
  component: Demo,
  parameters: { layout: 'fullscreen' },
  args: { step: 'mobile' },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** +91 mobile number with the DPDP consent box (T-086), on the real MSW auth handlers. */
export const MobileNumber: Story = {};
/** Six boxes, the dev OTP hint and the resend countdown (T-087). */
export const Otp: Story = { args: { step: 'otp' } };
/** First login: choose a 4-digit PIN for this browser (T-088). */
export const PinSetup: Story = { args: { step: 'pinSetup' } };
/** A trusted browser opens on PIN entry (T-088). */
export const PinEntry: Story = { args: { step: 'pinEntry' } };
/** After 5 wrong PINs (T-088). */
export const Locked: Story = { args: { step: 'locked' } };
