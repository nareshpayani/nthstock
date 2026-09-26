import { buttonVariants, IconWallet } from '@nthstock/ui';
import { Link } from '@tanstack/react-router';
import { useSession } from '@/shared/hooks/useSession';
import { heroGreeting } from '../model/greeting';
import { strings } from '../strings';

/**
 * Greeting hero (T-093): an IST greeting with the signed-in user's first name, and the onboarding
 * call to action: log in to start paper trading, or view virtual funds once signed in.
 */
export function Hero({ now }: { now: Date }) {
  const { status, session } = useSession();
  const signedIn = status === 'authenticated' && session !== null;
  return (
    <section
      aria-labelledby="dashboard-title"
      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-brand-soft p-4 lg:p-6"
    >
      <div className="grid max-w-2xl gap-1">
        <p className="text-label font-semibold tracking-wide text-brand uppercase">
          {strings.paperTag}
        </p>
        <h1 id="dashboard-title" className="text-title text-ink lg:text-display">
          {heroGreeting(now, signedIn ? session.user.name : null)}
        </h1>
        <p className="text-body font-normal text-ink-muted lg:text-lg">{strings.heroBody}</p>
      </div>
      {signedIn ? (
        <Link to="/funds" className={buttonVariants({ variant: 'primary' })}>
          <IconWallet size={18} />
          {strings.heroCta}
        </Link>
      ) : (
        <Link to="/login" className={buttonVariants({ variant: 'primary' })}>
          <IconWallet size={18} />
          {strings.heroCtaSignedOut}
        </Link>
      )}
    </section>
  );
}
