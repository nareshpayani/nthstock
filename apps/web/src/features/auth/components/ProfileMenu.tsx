import type { KycStatus } from '@nthstock/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconCheck,
  IconClock,
  IconInfo,
  IconLogout,
  IconSettings,
  IconUser,
  buttonVariants,
  cn,
} from '@nthstock/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import { useSession } from '@/shared/hooks/useSession';
import { useLogout } from '../hooks/useAuthMutations';
import { strings } from '../strings';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const kycStyle: Record<KycStatus, { className: string; icon: typeof IconCheck }> = {
  VERIFIED: { className: 'bg-up-soft text-up', icon: IconCheck },
  PENDING: { className: 'bg-marigold-soft text-ink', icon: IconClock },
  NOT_STARTED: { className: 'bg-canvas text-ink-muted', icon: IconInfo },
};

/** The mocked KYC status as an icon plus words, never colour alone. */
export function KycBadge({ status }: { status: KycStatus }) {
  const { className, icon: Icon } = kycStyle[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-label font-medium',
        className,
      )}
    >
      <Icon size={14} />
      {strings.profile.kyc[status]}
    </span>
  );
}

/**
 * The phone top bar's profile slot (NSTOCK-0466): the initials (a person icon when signed out or
 * unnamed), a link to the Account tab, which holds what the desktop profile menu does.
 */
export function AccountAvatar() {
  const { status, session } = useSession();
  if (status === 'unknown') {
    return <span aria-hidden="true" className="m-1 size-9 rounded-pill bg-canvas" />;
  }
  const name = session?.user.name ?? null;
  const shown = name ? initials(name) : undefined;
  return (
    <Link
      to="/account"
      aria-label={
        session
          ? strings.profile.menu(name ?? strings.profile.defaultName, shown)
          : strings.profile.accountSignedOut
      }
      className="grid size-11 place-items-center rounded-pill"
    >
      <span
        className={cn(
          'grid size-9 place-items-center rounded-pill text-label font-semibold',
          session ? 'bg-brand-soft text-ink' : 'bg-canvas text-ink-muted',
        )}
      >
        {shown ?? <IconUser size={18} />}
      </span>
    </Link>
  );
}

/**
 * The header's profile slot (T-090): "Log in" when signed out; when signed in, the initials open a
 * menu with the name, masked mobile, the mocked KYC badge, "Security" (two-factor, NSTOCK-0221)
 * and "Log out".
 */
export function ProfileMenu() {
  const { status, session } = useSession();
  const logout = useLogout();
  const here = useRouterState({ select: (s) => s.location.href });

  if (status === 'unknown') {
    // Holds the slot's size while the session is restored, so the header does not shift.
    return <span aria-hidden="true" className="ml-1 size-9 rounded-pill bg-canvas" />;
  }

  if (!session) {
    return (
      <Link
        to="/login"
        search={here.startsWith('/login') ? {} : { redirect: here }}
        className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'ml-1' })}
      >
        {strings.profile.logIn}
      </Link>
    );
  }

  const { user } = session;
  const name = user.name ?? strings.profile.defaultName;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={strings.profile.menu(name, user.name ? initials(user.name) : undefined)}
          className="ml-1 flex size-9 items-center justify-center rounded-pill bg-brand text-label font-semibold text-surface"
        >
          {user.name ? initials(user.name) : <IconUser size={18} />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel className="grid gap-1 px-3 py-2">
          <span className="text-body font-semibold text-ink">{name}</span>
          <span className="font-mono text-label text-ink-muted">
            {strings.profile.mobile(user.mobileMasked)}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <KycBadge status={user.kycStatus} />
            <span className="text-label text-ink-muted">{strings.profile.kycNote}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings/security">
            <IconSettings size={16} /> {strings.profile.security}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={logout.isPending} onSelect={() => logout.mutate()}>
          <IconLogout size={16} /> {strings.profile.logOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
