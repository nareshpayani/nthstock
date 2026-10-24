import { Skeleton } from '@nthstock/ui';
import { useEffect, useState } from 'react';
import { QR_QUIET_ZONE, qrPath } from '../model/qrPath';
import { strings } from '../strings';

type Drawn = { text: string; size: number; path: string };

/**
 * The `otpauth://` URI as a QR code for an authenticator app to scan (NSTOCK-0221). `qrcode` is
 * loaded on demand, so it only ever lands in this settings chunk, and the code is drawn as one SVG
 * path in the ink token colour on the surface colour.
 */
export function QrCode({ text }: { text: string }) {
  const [drawn, setDrawn] = useState<Drawn | null>(null);

  useEffect(() => {
    let live = true;
    void import('qrcode').then(({ create }) => {
      const { modules } = create(text, { errorCorrectionLevel: 'M' });
      const size = modules.size;
      const path = qrPath({ size, dark: (row, col) => modules.get(row, col) !== 0 });
      if (live) setDrawn({ text, size, path });
    });
    return () => {
      live = false;
    };
  }, [text]);

  if (drawn?.text !== text) {
    return (
      <span role="status" aria-label={strings.setup.qrLoading}>
        <Skeleton className="size-48 rounded-md" />
      </span>
    );
  }
  const box = drawn.size + QR_QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={strings.setup.qrLabel}
      viewBox={`0 0 ${String(box)} ${String(box)}`}
      shapeRendering="crispEdges"
      className="size-48 rounded-md border border-line bg-surface"
    >
      <path d={drawn.path} className="fill-ink" />
    </svg>
  );
}
