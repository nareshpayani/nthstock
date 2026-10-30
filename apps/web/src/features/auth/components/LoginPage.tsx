import type { LoginOtpPurpose, Session } from '@nthstock/contracts';
import { Button, buttonVariants, cn, IconHelp } from '@nthstock/ui';
import { formatIstDate } from '@nthstock/utils';
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
import { AuthCard } from './AuthCard';
import { MobileStep, type OtpSent } from './MobileStep';
import { OtpStep } from './OtpStep';
import { PinEntryStep, PinLocked } from './PinEntryStep';
import { PinSetupStep } from './PinSetupStep';
import { TotpStep } from './TotpStep';
import { TryDemo } from './TryDemo';

/** Long link labels wrap on a 320 px phone instead of widening the card (NSTOCK-0435). On a phone
    they are quiet text links, so the whole step fits one screen (NSTOCK-0481). */
const WRAP =
  'h-auto min-h-10 py-2 text-center whitespace-normal max-sm:min-h-11 max-sm:border-0 max-sm:bg-transparent max-sm:py-1 max-sm:text-brand';

type Step =
  | { kind: 'mobile'; purpose: LoginOtpPurpose; notice?: string; mobile?: string }
  | { kind: 'otp'; purpose: LoginOtpPurpose; sent: OtpSent }
  | { kind: 'totp'; challengeId: string }
  | { kind: 'deleted'; purgeAfter: string }
  | { kind: 'setPin' }
  | { kind: 'pin'; device: TrustedDeviceHint }
  | { kind: 'locked' };

export type LoginPageProps = {
  /** Where to go after logging in (`?redirect=`); only in-app paths are honoured. */
  redirect?: string | undefined;
  /** The dev OTP hint; defaults to showing it outside production api-mode builds. */
  devOtp?: string | null;
  /** Set after the user deleted their account (`?deleted=`): when its data is erased. */
  deletedPurgeAfter?: string | undefined;
  /** The reviewer link (`?try=1`): start Try demo without a tap. */
  autoStartDemo?: boolean;
};

/**
 * The login flow (E3): a trusted browser starts at PIN entry, everyone else at the mobile number;
 * then OTP, then the authenticator code when two-factor is on (NSTOCK-0220), then (first login)
 * PIN setup, then the page they came for.
 */
export function LoginPage({
  redirect,
  devOtp = devOtpHint,
  deletedPurgeAfter,
  autoStartDemo = false,
}: LoginPageProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(() => {
    if (deletedPurgeAfter) {
      return {
        kind: 'mobile',
        purpose: 'LOGIN',
        notice: strings.deleted.notice(formatIstDate(new Date(deletedPurgeAfter))),
      };
    }
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
          onAccountDeleted={(purgeAfter) => setStep({ kind: 'deleted', purgeAfter })}
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
    case 'deleted':
      content = (
        <AuthCard
          title={strings.deleted.title}
          description={strings.deleted.body(formatIstDate(new Date(step.purgeAfter)))}
          focusHeading
        >
          <Button block onClick={() => setStep({ kind: 'mobile', purpose: 'LOGIN' })}>
            {strings.deleted.useAnother}
          </Button>
        </AuthCard>
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
    // A card on a wide screen; on a phone the step is the whole screen, edge to edge from the top,
    // clear of the notch and the home indicator, like a native sign-in (NSTOCK-0481).
    <main className="grid min-h-dvh grid-cols-[minmax(0,1fr)] place-items-center bg-canvas p-4 max-sm:place-items-stretch max-sm:bg-surface max-sm:p-0">
      <div className="grid w-full max-w-sm grid-cols-[minmax(0,1fr)] gap-6 rounded-lg border border-line bg-surface p-6 max-sm:max-w-none max-sm:content-start max-sm:gap-5 max-sm:rounded-none max-sm:border-0 max-sm:px-5 max-sm:pt-[max(1.5rem,env(safe-area-inset-top))] max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-[359px]:px-4">
        {content}
        {devOtp ? <TryDemo devOtp={devOtp} autoStart={autoStartDemo} /> : null}
        <p className="text-label text-ink-muted">{strings.paperNote}</p>
        <div className="grid gap-3 max-sm:gap-0">
          {/* Before logging in: what the app does and how to trade, then back here (NSTOCK-0280). */}
          <Link
            to="/guide"
            className={cn(buttonVariants({ variant: 'secondary', block: true }), WRAP)}
          >
            <IconHelp size={16} /> {strings.guide}
          </Link>
          <Link
            to="/dashboard"
            className={cn(buttonVariants({ variant: 'secondary', block: true }), WRAP)}
          >
            {strings.explore}
          </Link>
        </div>
      </div>
    </main>
  );
}
