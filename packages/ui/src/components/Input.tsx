import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../lib/cn.js';
import { useFieldControl } from './Field.js';

export const inputFrameClass =
  'flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-3 text-body text-ink transition-colors focus-within:border-brand focus-within:ring-3 focus-within:ring-brand-soft has-[[aria-invalid=true]]:border-down has-disabled:opacity-50';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Content before the text, e.g. a search icon. */
  leading?: ReactNode;
  /** Content after the text, e.g. a unit or clear button. */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
};

export function Input({ leading, trailing, className, ...rest }: InputProps) {
  const control = useFieldControl({
    ...(rest.id ? { id: rest.id } : {}),
    ...(rest['aria-describedby'] ? { 'aria-describedby': rest['aria-describedby'] } : {}),
  });
  return (
    <div className={cn(inputFrameClass, className)}>
      {leading ? <span className="flex text-ink-muted">{leading}</span> : null}
      <input
        {...rest}
        {...control}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-muted"
      />
      {trailing ? <span className="flex text-label text-ink-muted">{trailing}</span> : null}
    </div>
  );
}
