import { Dialog } from '@nthstock/ui';
import { strings } from '../strings';

export type ShortcutHelpDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** The "?" dialog listing every global shortcut (T-028). */
export function ShortcutHelpDialog({ open, onOpenChange }: ShortcutHelpDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={strings.shortcuts.title}
      description={strings.shortcuts.description}
    >
      <dl className="grid gap-2">
        {strings.shortcuts.list.map((shortcut) => (
          <div
            key={shortcut.action}
            className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-b-0"
          >
            <dt className="text-body text-ink">{shortcut.action}</dt>
            <dd className="flex gap-1">
              {shortcut.keys.map((key) => (
                <kbd
                  key={key}
                  className="min-w-7 rounded-sm border border-line bg-canvas px-1.5 py-0.5 text-center font-mono text-label text-ink"
                >
                  {key}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-label text-ink-muted">{strings.shortcuts.later}</p>
    </Dialog>
  );
}
