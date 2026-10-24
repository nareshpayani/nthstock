import type { TotpEnrolResponse } from '@nthstock/contracts';
import { Button, IconCheck, IconInfo, cn, useToast } from '@nthstock/ui';
import { useState } from 'react';
import { StepUpCancelledError, useEnsureSteppedUp } from '@/features/auth';
import { Card } from '@/shared/components/Card';
import { useSession } from '@/shared/hooks/useSession';
import { useTwoFactor } from '../hooks/useTwoFactor';
import { describeTwoFactorError } from '../model/twoFactorError';
import { strings } from '../strings';
import { RegenerateCodesDialog } from './RegenerateCodesDialog';
import { TotpSetupDialog } from './TotpSetupDialog';
import { TurnOffTotpDialog } from './TurnOffTotpDialog';

/** On or off as an icon plus a word, never colour alone. */
function StatusBadge({ on }: { on: boolean }) {
  const Icon = on ? IconCheck : IconInfo;
  return (
    <span
      aria-label={strings.twoFactor.statusLabel(on)}
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-label font-medium',
        on ? 'bg-up-soft text-up' : 'bg-canvas text-ink-muted',
      )}
    >
      <Icon size={14} />
      {on ? strings.twoFactor.on : strings.twoFactor.off}
    </span>
  );
}

/**
 * The two-factor card (NSTOCK-0221): its status, Turn on (the setup wizard), and when on, New
 * recovery codes and Turn off. Every action is behind a step-up; `onFactorChanged` follows turning
 * it on or off.
 */
export function TwoFactorCard({ onFactorChanged }: { onFactorChanged?: () => void }) {
  const { session } = useSession();
  const toast = useToast();
  const twoFactor = useTwoFactor();
  const ensureSteppedUp = useEnsureSteppedUp();
  const [enrol, setEnrol] = useState<TotpEnrolResponse | null>(null);
  const [dialog, setDialog] = useState<'off' | 'codes' | null>(null);
  if (!session) return null;
  const { totpEnabled, mobileMasked } = session.user;

  const failed = (failure: unknown) => {
    if (failure instanceof StepUpCancelledError) return;
    toast.show({ title: describeTwoFactorError(failure), tone: 'error' });
  };

  const turnOn = () => {
    twoFactor.enrol.mutate(undefined, { onSuccess: setEnrol, onError: failed });
  };

  const open = (which: 'off' | 'codes') => {
    ensureSteppedUp().then(() => setDialog(which), failed);
  };

  return (
    <Card title={strings.twoFactor.title} aside={<StatusBadge on={totpEnabled} />}>
      <div className="grid gap-4">
        <p className="max-w-prose text-body text-ink-muted">{strings.twoFactor.body}</p>
        <div className="flex flex-wrap gap-2">
          {totpEnabled ? (
            <>
              <Button variant="secondary" onClick={() => open('codes')}>
                {strings.twoFactor.newCodes}
              </Button>
              <Button variant="secondary" className="text-down" onClick={() => open('off')}>
                {strings.twoFactor.turnOff}
              </Button>
            </>
          ) : (
            <Button loading={twoFactor.enrol.isPending} onClick={turnOn}>
              {strings.twoFactor.turnOn}
            </Button>
          )}
        </div>
      </div>
      <TotpSetupDialog
        enrol={enrol}
        confirm={twoFactor.confirm}
        mobileMasked={mobileMasked}
        onClose={() => setEnrol(null)}
        onDone={() => {
          setEnrol(null);
          onFactorChanged?.();
          toast.show({
            title: strings.twoFactor.turnedOn,
            description: strings.twoFactor.turnedOnBody,
            tone: 'success',
          });
        }}
      />
      <TurnOffTotpDialog
        open={dialog === 'off'}
        onOpenChange={(next) => setDialog(next ? 'off' : null)}
        disable={twoFactor.disable}
        onDone={() => {
          setDialog(null);
          onFactorChanged?.();
          toast.show({
            title: strings.twoFactor.turnedOff,
            description: strings.twoFactor.turnedOffBody,
            tone: 'success',
          });
        }}
      />
      <RegenerateCodesDialog
        open={dialog === 'codes'}
        onOpenChange={(next) => setDialog(next ? 'codes' : null)}
        regenerate={twoFactor.regenerate}
        mobileMasked={mobileMasked}
      />
    </Card>
  );
}
