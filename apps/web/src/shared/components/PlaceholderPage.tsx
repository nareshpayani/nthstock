import { EmptyState } from '@nthstock/ui';
import type { ReactNode } from 'react';
import { PageHeader } from './PageHeader';

export type PlaceholderPageProps = {
  title: string;
  description: string;
  emptyTitle: string;
  emptyBody: string;
  icon?: ReactNode;
  action?: ReactNode;
};

/** A route page whose feature has not been built yet: title plus an honest empty state. */
export function PlaceholderPage({
  title,
  description,
  emptyTitle,
  emptyBody,
  icon,
  action,
}: PlaceholderPageProps) {
  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <PageHeader title={title} description={description} />
      <div className="rounded-lg border border-line bg-surface">
        <EmptyState title={emptyTitle} description={emptyBody} icon={icon} action={action} />
      </div>
    </div>
  );
}
