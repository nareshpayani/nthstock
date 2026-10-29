import { cn, IconButton } from '@nthstock/ui';
import { useState } from 'react';
import {
  chartSnapshot,
  deliverSnapshot,
  snapshotCaption,
  snapshotFileName,
} from '../model/snapshot';
import { strings } from '../strings';
import type { ChartHandle } from './PriceChartCanvas';

export type ChartSnapshotButtonProps = {
  handle: ChartHandle | null;
  /** "INFY" or "NIFTY 50": the caption's first word and the file name. */
  name: string;
  /** The rest of the caption: range, bar size. */
  details: readonly (string | undefined)[];
  /** Phones share; desktops download. Also the 44 px target. */
  touch?: boolean;
  className?: string;
};

/**
 * Saves the chart, with its drawings and a caption, as a PNG (NSTOCK-0463). On a phone the Share
 * sheet opens, so it can go straight to a chat.
 */
export function ChartSnapshotButton({
  handle,
  name,
  details,
  touch = false,
  className,
}: ChartSnapshotButtonProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const onClick = async () => {
    if (!handle || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const at = new Date();
      const blob = await chartSnapshot(handle, snapshotCaption([name, ...details], at));
      if (!blob) throw new Error('empty canvas');
      const outcome = await deliverSnapshot(blob, snapshotFileName(name, at), { share: touch });
      if (outcome !== 'cancelled') {
        setStatus(outcome === 'shared' ? strings.snapshot.shared : strings.snapshot.saved);
      }
    } catch {
      setStatus(strings.snapshot.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <IconButton
        label={touch ? strings.snapshot.share : strings.snapshot.save}
        icon={<CameraGlyph />}
        variant="secondary"
        size={touch ? undefined : 'sm'}
        className={cn(touch && 'size-11', className)}
        loading={busy}
        disabled={!handle}
        onClick={() => void onClick()}
      />
      <span role="status" className="sr-only">
        {status}
      </span>
    </>
  );
}

/** A camera, for the snapshot button. */
function CameraGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7a1 1 0 0 1 1-1h2.5L8 4h4l1.5 2H16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />
      <circle cx="10" cy="10.5" r="3" />
    </svg>
  );
}
