import { StepUpDialog } from '@/features/auth';
import { PageHeader } from '@/shared/components/PageHeader';
import { strings } from '../strings';
import { TwoFactorCard } from './TwoFactorCard';

/**
 * /settings/security (NSTOCK-0221): two-factor authentication, with the shared step-up dialog
 * mounted once for every sensitive action on the page.
 */
export function SecurityPage() {
  return (
    <div className="mx-auto grid w-full max-w-[880px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <PageHeader title={strings.title} description={strings.description} />
      <TwoFactorCard />
      <StepUpDialog />
    </div>
  );
}
