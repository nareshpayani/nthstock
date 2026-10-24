import { useState } from 'react';
import { StepUpDialog } from '@/features/auth';
import { PageHeader } from '@/shared/components/PageHeader';
import { strings } from '../strings';
import { ActiveSessionsCard } from './ActiveSessionsCard';
import { TwoFactorCard } from './TwoFactorCard';

/**
 * /settings/security (NSTOCK-0221, NSTOCK-0226): two-factor authentication and the active sessions,
 * with the shared step-up dialog mounted once for every sensitive action on the page. Turning
 * two-factor on or off offers to log out the other devices.
 */
export function SecurityPage() {
  const [factorChanged, setFactorChanged] = useState(false);
  return (
    <div className="mx-auto grid w-full max-w-[880px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <PageHeader title={strings.title} description={strings.description} />
      <TwoFactorCard onFactorChanged={() => setFactorChanged(true)} />
      <ActiveSessionsCard
        offerLogOutOthers={factorChanged}
        onOfferHandled={() => setFactorChanged(false)}
      />
      <StepUpDialog />
    </div>
  );
}
