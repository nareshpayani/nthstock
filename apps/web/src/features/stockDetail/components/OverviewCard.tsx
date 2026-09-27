import type { Instrument, InstrumentProfile } from '@nthstock/contracts';
import { ErrorState, Skeleton } from '@nthstock/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';
import { Card } from '@/shared/components/Card';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { profileQuery } from '../api/stockDetailQueries';
import { aboutPreview } from '../model/aboutPreview';
import { strings } from '../strings';

export type OverviewCardProps = {
  instrument: Instrument;
};

const chip =
  'inline-flex items-center rounded-pill border border-line bg-canvas px-2.5 py-0.5 text-label font-medium text-ink';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <dt className="text-label text-ink-muted">{label}</dt>
      <dd className="m-0 flex flex-wrap gap-2">{children}</dd>
    </div>
  );
}

/**
 * About text collapsed to a preview with a Read more / Read less button (T-111). The preview is
 * the text itself cut short, so screen readers hear what is shown; the button says whether it is
 * expanded and which paragraph it controls.
 */
function About({ name, text }: { name: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const textId = useId();
  const preview = aboutPreview(text);
  return (
    <div className="grid justify-items-start gap-1">
      <h3 className="text-body font-semibold text-ink">{strings.overview.about(name)}</h3>
      <p id={textId} className="text-body text-ink">
        {expanded || preview === null ? text : preview}
      </p>
      {preview === null ? null : (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded((open) => !open)}
          className="rounded-sm text-body font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {expanded ? strings.overview.readLess : strings.overview.readMore}
        </button>
      )}
    </div>
  );
}

function OverviewBody({ profile }: { profile: InstrumentProfile }) {
  return (
    <div className="grid gap-5">
      <dl className="m-0 grid gap-4 sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:gap-x-8">
        <Fact label={strings.overview.sector}>
          <span className={chip}>{profile.sector}</span>
        </Fact>
        <Fact label={strings.overview.size}>
          <span className={chip}>{strings.overview.capCategory[profile.capCategory]}</span>
        </Fact>
        <Fact label={strings.overview.indices}>
          {profile.indices.length === 0 ? (
            <span className="text-body text-ink-muted">{strings.overview.noIndices}</span>
          ) : (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {profile.indices.map((index) => (
                <li key={index.symbol}>
                  <Link
                    to="/stocks/$symbol"
                    params={{ symbol: index.symbol }}
                    aria-label={strings.overview.indexLink(index.name)}
                    className={`${chip} hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`}
                  >
                    {index.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Fact>
      </dl>
      <About name={profile.name} text={profile.about} />
    </div>
  );
}

/**
 * Company overview (T-111): sector and size chips, the indices the stock belongs to (each a link
 * to that index's page) and the about text with Read more. Equities only.
 */
export function OverviewCard({ instrument }: OverviewCardProps) {
  const api = useApiClient();
  const profile = useQuery(
    profileQuery(api, { symbol: instrument.symbol, exchange: instrument.exchange }),
  );
  return (
    <Card title={strings.overview.title}>
      {profile.data ? (
        <OverviewBody profile={profile.data} />
      ) : profile.isError ? (
        <ErrorState
          title={strings.overview.errorTitle}
          description={strings.overview.errorBody}
          retryLabel={strings.overview.retry}
          onRetry={() => void profile.refetch()}
        />
      ) : (
        <div role="status" aria-label={strings.overview.loading} className="grid gap-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
    </Card>
  );
}
