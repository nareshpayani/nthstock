import { buttonVariants } from '@nthstock/ui';
import { Link } from '@tanstack/react-router';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { strings } from '../strings';

export type StockNotFoundProps = { symbol: string };

/** /stocks/<unknown symbol> (T-105): says which symbol was not found and how to go on. */
export function StockNotFound({ symbol }: StockNotFoundProps) {
  useDocumentTitle(strings.notFound.pageTitle);
  return (
    <div className="mx-auto grid w-full max-w-lg justify-items-center gap-3 rounded-lg border border-line bg-surface px-4 py-10 text-center">
      <h1 className="text-title text-ink">{strings.notFound.title}</h1>
      <p className="text-body text-ink-muted">{strings.notFound.body(symbol)}</p>
      <Link to="/dashboard" className={buttonVariants({ variant: 'primary' })}>
        {strings.notFound.back}
      </Link>
    </div>
  );
}
