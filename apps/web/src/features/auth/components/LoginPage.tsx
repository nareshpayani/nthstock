import type { LoginOtpPurpose, Session } from '@nthstock/contracts';
import { buttonVariants, IconHelp } from '@nthstock/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { safeRedirect } from '@/shared/lib/safeRedirect';
import { devOtpHint } from '../model/devOtp';
import {
  forgetTrustedDevice,
  readTrustedDevice,
  type TrustedDeviceHint,
} from '../store/trustedDevice';
import { strings } from '../strings';
import { MobileStep, type OtpSent } from './MobileStep';
import { OtpStep } from './OtpStep';
import { PinEntryStep, PinLocked } from './PinEntryStep';
import { PinSetupStep } from './PinSetupStep';
import { TotpStep } from './TotpStep';
import { TryDemo } from './TryDemo';

type Step =
  | { kind: 'mobile'; purpose: LoginOtpPurpose; notice?: string; mobile?: string }
  | { kind: 'otp'; purpose: LoginOtpPurpose; sent: OtpSent }
  | { kind: 'totp'; challengeId: string }
  | { kind: 'setPin' }
  | { kind: 'pin'; device: TrustedDeviceHint }
  | { kind: 'locked' };

export type LoginPageProps = {
  /** Where to go after logging in (`?redirect=`); only in-app paths are honoured. */
  redirect?: string | undefined;
  /** The dev OTP hint; defaults to showing it outside production api-mode builds. */
  devOtp?: string | null;
};

/**
 * The login flow (E3): a trusted browser starts at PIN entry, everyone else at the mobile number;
 * then OTP, then the authenticator code when two-factor is on (NSTOCK-0220), then (first login)
 * PIN setup, then the page they came for.
 */
export function LoginPage({ redirect, devOtp = devOtpHint }: LoginPageProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(() => {
    const device = readTrustedDevice();
    return device ? { kind: 'pin', device } : { kind: 'mobile', purpose: 'LOGIN' };
  });

  const finish = () => void navigate({ href: safeRedirect(redirect), replace: true });

  const onVerified = (session: Session) => {
    if (session.user.pinSet) finish();
    else setStep({ kind: 'setPin' });
  };

  let content;
  switch (step.kind) {
    case 'mobile':
      content = (
        <MobileStep
          key={step.purpose}
          purpose={step.purpose}
          notice={step.notice}
          defaultMobile={step.mobile}
          onSent={(sent) => setStep({ kind: 'otp', purpose: step.purpose, sent })}
        />
      );
      break;
    case 'otp':
      content = (
        <OtpStep
          purpose={step.purpose}
          sent={step.sent}
          devOtp={devOtp}
          onVerified={onVerified}
          onTotpRequired={(challengeId) => setStep({ kind: 'totp', challengeId })}
          onChangeNumber={() =>
            setStep({ kind: 'mobile', purpose: step.purpose, mobile: step.sent.mobile })
          }
        />
      );
      break;
    case 'totp':
      content = (
        <TotpStep
          key={step.challengeId}
          challengeId={step.challengeId}
          onVerified={onVerified}
          onRestart={() => setStep({ kind: 'mobile', purpose: 'LOGIN' })}
        />
      );
      break;
    case 'setPin':
      content = <PinSetupStep onDone={finish} />;
      break;
    case 'pin':
      content = (
        <PinEntryStep
          device={step.device}
          onSuccess={finish}
          onTotpRequired={(challengeId) => setStep({ kind: 'totp', challengeId })}
          onLocked={() => setStep({ kind: 'locked' })}
          onUntrusted={() => {
            forgetTrustedDevice();
            setStep({ kind: 'mobile', purpose: 'LOGIN', notice: strings.mobile.untrustedDevice });
          }}
          onUseOtp={() => setStep({ kind: 'mobile', purpose: 'LOGIN' })}
        />
      );
      break;
    case 'locked':
      content = <PinLocked onUnlock={() => setStep({ kind: 'mobile', purpose: 'UNLOCK_PIN' })} />;
      break;
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-4">
      <div className="grid w-full max-w-sm gap-6 rounded-lg border border-line bg-surface p-6">
        {content}
        {devOtp ? <TryDemo devOtp={devOtp} /> : null}
        <p className="text-label text-ink-muted">{strings.paperNote}</p>
        <div className="grid gap-3">
          {/* Before logging in: what the app does and how to trade, then back here (NSTOCK-0280). */}
          <Link to="/guide" className={buttonVariants({ variant: 'secondary', block: true })}>
            <IconHelp size={16} /> {strings.guide}
          </Link>
          <Link to="/dashboard" className={buttonVariants({ variant: 'secondary', block: true })}>
            {strings.explore}
          </Link>
        </div>
      </div>
    </main>
  );
}
