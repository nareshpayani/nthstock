import { IconChevronRight, buttonVariants, cn, Button } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { KycBadge, useLogout } from '@/features/auth';
import { fundsSummaryQuery } from '@/features/funds';
import { useSession } from '@/shared/hooks/useSession';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { strings } from '../strings';

const MENU = [
  { to: '/funds', ...strings.items.funds },
  { to: '/positions', ...strings.items.portfolio },
  { to: '/watchlist', ...strings.items.watchlists },
  { to: '/settings/security', ...strings.items.security },
  { to: '/guide', ...strings.items.guide },
] as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function AvailableCash() {
  const api = useApiClient();
  const funds = useQuery(fundsSummaryQuery(api));
  let figure;
  if (funds.data) figure = formatInr(funds.data.available);
  else if (funds.isError) figure = strings.fundsError;
  else figure = <span className="inline-block h-6 w-36 animate-pulse rounded-sm bg-canvas" />;
  return (
    <Link
      to="/funds"
      className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <span className="grid gap-0.5">
        <span className="text-label text-ink-muted">{strings.available}</span>
        <span className="font-mono text-xl font-semibold text-ink tabular-nums">{figure}</span>
      </span>
      <span className={buttonVariants({ variant: 'primary', size: 'sm' })}>{strings.fundsCta}</span>
    </Link>
  );
}

/**
 * The phone app's Account tab (NSTOCK-0466): the profile with its mock KYC, the cash available to
 * trade, then Funds, Positions, Watchlists, Security and privacy and the documentation, and
 * Log out. It holds what the desktop header's profile and More menus do; alerts and notifications
 * stay in the top bar's bell, as on the desktop. Signed out, it asks to log in.
 */
export function AccountPage() {
  const { status, session } = useSession();
  const logout = useLogout();

  if (status !== 'authenticated' || !session) {
    return (
      <div className="mx-auto grid w-full max-w-xl gap-4">
        <h1 className="sr-only">{strings.title}</h1>
        <section className="grid justify-items-center gap-3 rounded-lg border border-line bg-surface p-6 text-center">
          <h2 className="text-lg font-semibold text-ink">{strings.signedOut.title}</h2>
          <p className="text-body text-ink-muted">{strings.signedOut.body}</p>
          <Link
            to="/login"
            search={{ redirect: '/account' }}
            className={buttonVariants({ variant: 'primary' })}
          >
            {strings.signedOut.cta}
          </Link>
        </section>
        <AccountMenu />
      </div>
    );
  }

  const { user } = session;
  const name = user.name ?? strings.defaultName;
  return (
    <div className="mx-auto grid w-full max-w-xl gap-3">
      <h1 className="sr-only">{strings.title}</h1>
      <section
        aria-label={strings.profileLabel}
        className="flex items-center gap-4 rounded-lg border border-line bg-surface p-4"
      >
        <span
          aria-hidden="true"
          className="grid size-13 shrink-0 place-items-center rounded-pill bg-brand text-lg font-semibold text-surface"
        >
          {initials(name)}
        </span>
        <span className="grid min-w-0 gap-1">
          <span className="truncate text-lg font-semibold text-ink">{name}</span>
          <span className="font-mono text-label text-ink-muted">{`+91 ${user.mobileMasked}`}</span>
          <span className="justify-self-start">
            <KycBadge status={user.kycStatus} />
          </span>
        </span>
      </section>
      <AvailableCash />
      <AccountMenu />
      <Button
        variant="secondary"
        size="lg"
        className="text-down"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
      >
        {strings.logOut}
      </Button>
      <p className="text-center text-label text-ink-muted">{strings.paperNote}</p>
    </div>
  );
}

function AccountMenu() {
  return (
    <nav aria-label={strings.menuLabel} className="rounded-lg border border-line bg-surface px-4">
      <ul>
        {MENU.map((item, index) => (
          <li key={item.to} className={cn(index > 0 && 'border-t border-line')}>
            <Link to={item.to} className="flex min-h-14 items-center gap-3 py-2">
              <span className="grid flex-1 gap-0.5">
                <span className="text-body font-medium text-ink">{item.label}</span>
                <span className="text-label text-ink-muted">{item.hint}</span>
              </span>
              <IconChevronRight size={18} className="text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
