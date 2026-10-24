import { isApiError } from '@nthstock/apiClient';
import type { ActiveSession } from '@nthstock/contracts';
import { Button, Dialog, Skeleton, useToast } from '@nthstock/ui';
import { formatIstDate, formatIstTime } from '@nthstock/utils';
import { useState } from 'react';
import { StepUpCancelledError } from '@/features/auth';
import { Card } from '@/shared/components/Card';
import { useActiveSessions } from '../hooks/useActiveSessions';
import { describeTwoFactorError } from '../model/twoFactorError';
import { strings } from '../strings';

/** Activity within the last two minutes reads as "Active now". */
const ACTIVE_NOW_MS = 2 * 60_000;

const istDateTime = (iso: string) => {
  const date = new Date(iso);
  return `${formatIstDate(date)}, ${formatIstTime(date)}`;
};

function Badge({ children, title }: { children: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-pill bg-canvas px-2 py-0.5 text-label font-medium text-ink-muted"
    >
      {children}
    </span>
  );
}

function SessionRow({
  session,
  asOf,
  onLogOut,
}: {
  session: ActiveSession;
  /** When the list was fetched (ms). */
  asOf: number;
  onLogOut: () => void;
}) {
  const active = session.current || asOf - Date.parse(session.lastActiveAt) < ACTIVE_NOW_MS;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">{session.deviceLabel}</span>
          {session.current ? <Badge>{strings.sessions.thisDevice}</Badge> : null}
          {session.trusted ? (
            <Badge title={strings.sessions.trustedHint}>{strings.sessions.trusted}</Badge>
          ) : null}
        </div>
        <p className="text-label text-ink-muted">
          {strings.sessions.signedIn(istDateTime(session.createdAt))}
          {' · '}
          {active
            ? strings.sessions.activeNow
            : strings.sessions.lastActive(istDateTime(session.lastActiveAt))}
        </p>
      </div>
      {session.current ? null : (
        <Button
          variant="secondary"
          size="sm"
          aria-label={strings.sessions.logOutLabel(session.deviceLabel)}
          onClick={onLogOut}
        >
          {strings.sessions.logOut}
        </Button>
      )}
    </li>
  );
}

type Confirm =
  { kind: 'one'; session: ActiveSession } | { kind: 'others' } | { kind: 'offer' } | null;

export type ActiveSessionsCardProps = {
  /** Set after two-factor is turned on or off: offer to log out the other devices (ASVS 3.3.3). */
  offerLogOutOthers?: boolean;
  onOfferHandled?: () => void;
};

/**
 * The active sessions card (NSTOCK-0226): every live session with its device, "This device" and
 * "Trusted" badges and IST times; Log out per other row and Log out all other devices, each behind
 * a confirm and a step-up. The current row has no Log out (the profile menu does that).
 */
export function ActiveSessionsCard({
  offerLogOutOthers = false,
  onOfferHandled,
}: ActiveSessionsCardProps) {
  const toast = useToast();
  const { list, revoke, revokeOthers } = useActiveSessions();
  const [confirm, setConfirm] = useState<Confirm>(null);

  const sessions = list.data?.sessions ?? [];
  const others = sessions.filter((s) => !s.current);
  // The offer shows once the list is in and only when there is someone else to log out.
  const offering = offerLogOutOthers && list.isSuccess && others.length > 0;
  const shown: Confirm = offering ? { kind: 'offer' } : confirm;

  const close = () => {
    setConfirm(null);
    if (offerLogOutOthers) onOfferHandled?.();
  };

  const failed = (failure: unknown) => {
    if (failure instanceof StepUpCancelledError) return;
    if (isApiError(failure) && failure.code === 'NOT_FOUND') {
      toast.show({ title: strings.sessions.gone, tone: 'info' });
      return;
    }
    toast.show({ title: describeTwoFactorError(failure), tone: 'error' });
  };

  const run = () => {
    if (!shown) return;
    if (shown.kind === 'one') {
      const { session } = shown;
      revoke.mutate(session.id, {
        onSuccess: () =>
          toast.show({
            title: strings.sessions.loggedOutOne(session.deviceLabel),
            tone: 'success',
          }),
        onError: failed,
      });
    } else {
      revokeOthers.mutate(undefined, {
        onSuccess: ({ revoked }) =>
          toast.show({ title: strings.sessions.loggedOutOthers(revoked), tone: 'success' }),
        onError: failed,
      });
    }
    close();
  };

  const dialogCopy =
    shown?.kind === 'one'
      ? {
          title: strings.sessions.confirmOneTitle,
          body: strings.sessions.confirmOneBody(shown.session.deviceLabel),
          confirm: strings.sessions.logOut,
          cancel: strings.sessions.cancel,
        }
      : shown?.kind === 'offer'
        ? {
            title: strings.sessions.offerTitle,
            body: strings.sessions.offerBody(others.length),
            confirm: strings.sessions.logOutOthers,
            cancel: strings.sessions.notNow,
          }
        : {
            title: strings.sessions.confirmOthersTitle,
            body: strings.sessions.confirmOthersBody(others.length),
            confirm: strings.sessions.logOutOthers,
            cancel: strings.sessions.cancel,
          };

  return (
    <Card title={strings.sessions.title}>
      <div className="grid gap-4">
        <p className="max-w-prose text-body text-ink-muted">{strings.sessions.body}</p>
        {list.isPending ? (
          <div className="grid gap-2" aria-label={strings.sessions.loading} role="status">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : list.isError ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-body text-ink-muted">{strings.sessions.loadFailed}</p>
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              {strings.sessions.retry}
            </Button>
          </div>
        ) : (
          <ul aria-label={strings.sessions.title} className="divide-y divide-line">
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                asOf={list.dataUpdatedAt}
                onLogOut={() => setConfirm({ kind: 'one', session })}
              />
            ))}
          </ul>
        )}
        {list.isSuccess ? (
          others.length > 0 ? (
            <div>
              <Button
                variant="secondary"
                className="text-down"
                loading={revokeOthers.isPending}
                onClick={() => setConfirm({ kind: 'others' })}
              >
                {strings.sessions.logOutOthers}
              </Button>
            </div>
          ) : (
            <p className="text-label text-ink-muted">{strings.sessions.onlyThis}</p>
          )
        ) : null}
      </div>
      <Dialog
        open={shown !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={dialogCopy.title}
        description={dialogCopy.body}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            {dialogCopy.cancel}
          </Button>
          <Button variant="danger" onClick={run}>
            {dialogCopy.confirm}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
