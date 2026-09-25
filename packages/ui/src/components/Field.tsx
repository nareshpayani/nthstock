import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

type FieldContextValue = {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/** Props a control inside <Field> spreads to link its label, hint and error. */
export type FieldControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

/** Reads the surrounding Field (if any) so the control gets its id and aria wiring. */
export function useFieldControl(own: FieldControlProps = {}): FieldControlProps {
  const field = useContext(FieldContext);
  if (!field) return own;
  const describedBy = [field.describedBy, own['aria-describedby']].filter(Boolean).join(' ');
  return {
    id: own.id ?? field.id,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(field.invalid || own['aria-invalid'] ? { 'aria-invalid': true } : {}),
  };
}

export type FieldProps = {
  label: ReactNode;
  /** Helper text under the control. */
  hint?: ReactNode;
  /** Error text. When set, the control is aria-invalid and the error is announced. */
  error?: ReactNode;
  /** Label shown visually hidden (still read by screen readers). */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
};

/** Label, control, hint and error, wired together with ids and aria-describedby. */
export function Field({ label, hint, error, hideLabel = false, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className={cn('grid gap-1', className)}>
        <label htmlFor={id} className={cn('text-label text-ink-muted', hideLabel && 'sr-only')}>
          {label}
        </label>
        {children}
        {error ? (
          <p id={errorId} role="alert" className="text-label text-down">
            {error}
          </p>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-label text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
