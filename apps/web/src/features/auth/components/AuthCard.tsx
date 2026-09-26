import { Logo } from '@nthstock/ui';
import { useEffect, useRef, type ReactNode } from 'react';

export type AuthCardProps = {
  title: string;
  description?: ReactNode;
  /** Move focus to the heading when the step opens (not when a step focuses its own input). */
  focusHeading?: boolean;
  children: ReactNode;
};

/** One login step: logo, heading, description and the step's content. */
export function AuthCard({ title, description, focusHeading = false, children }: AuthCardProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) heading.current?.focus();
  }, [focusHeading]);
  return (
    <section aria-labelledby="auth-step-title" className="grid gap-6">
      <Logo />
      <div className="grid gap-1">
        <h1
          id="auth-step-title"
          ref={heading}
          tabIndex={-1}
          className="text-title text-ink outline-none"
        >
          {title}
        </h1>
        {description ? <p className="text-body text-ink-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A form-level error, announced when it appears. */
export function FormError({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="rounded-md bg-down-soft px-3 py-2 text-label text-down">
      {children}
    </p>
  ) : null;
}
