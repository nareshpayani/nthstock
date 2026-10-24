import { Button, IconCheck, useToast } from '@nthstock/ui';
import { useId, useState } from 'react';
import { downloadRecoveryCodes, recoveryCodesText } from '../model/recoveryCodesFile';
import { strings } from '../strings';

export type RecoveryCodesProps = {
  codes: readonly string[];
  mobileMasked: string;
  onDone: () => void;
};

/**
 * The recovery codes, shown once (NSTOCK-0221): Copy and Download .txt, and Done only after the
 * user ticks "I have saved these codes", so nobody closes the dialog without keeping them.
 */
export function RecoveryCodes({ codes, mobileMasked, onDone }: RecoveryCodesProps) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const savedId = useId();
  const listId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodesText(codes, mobileMasked));
      setCopied(true);
    } catch {
      toast.show({ title: strings.codes.copyFailed, tone: 'error' });
    }
  };

  return (
    <div className="grid gap-4">
      <p className="text-body text-ink-muted">{strings.codes.body}</p>
      <p id={listId} className="sr-only">
        {strings.codes.listLabel}
      </p>
      <ul
        aria-labelledby={listId}
        className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-line bg-canvas p-4 font-mono text-body text-ink select-all"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={copied ? <IconCheck size={16} /> : undefined}
          onClick={() => void copy()}
        >
          {copied ? strings.setup.copied : strings.codes.copy}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => downloadRecoveryCodes(codes, mobileMasked)}
        >
          {strings.codes.download}
        </Button>
      </div>
      <label
        htmlFor={savedId}
        className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-label text-ink"
      >
        <input
          id={savedId}
          type="checkbox"
          className="size-4 shrink-0 accent-brand"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        {strings.codes.saved}
      </label>
      <Button block disabled={!saved} onClick={onDone}>
        {strings.codes.done}
      </Button>
    </div>
  );
}
