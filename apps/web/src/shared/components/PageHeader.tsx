import type { ReactNode } from 'react';

export type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
};

/** Page title row used by every route page. The title is the page's only <h1>. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1">
        <h1 className="text-title text-ink">{title}</h1>
        {description ? <p className="text-body text-ink-muted">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}
