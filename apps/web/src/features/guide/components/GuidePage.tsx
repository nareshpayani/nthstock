import { buttonVariants } from '@nthstock/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Card } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { strings } from '../strings';

const SECTIONS = [
  { id: 'what', title: strings.intro.title },
  { id: 'try', title: strings.tryIt.title },
  { id: 'features', title: strings.features.title },
  { id: 'buy', title: strings.buy.title },
  { id: 'sell', title: strings.sell.title },
  { id: 'stack', title: strings.stack.title },
  { id: 'run', title: strings.run.title },
  { id: 'limits', title: strings.limits.title },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const titleOf = (id: SectionId) => SECTIONS.find((s) => s.id === id)?.title ?? '';

/** One guide section: a card the table of contents can jump to. */
function GuideSection({ id, children }: { id: SectionId; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-[calc(var(--header-h)+1rem)]">
      <Card title={titleOf(id)}>{children}</Card>
    </div>
  );
}

function Steps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="grid list-decimal gap-2 pl-5 text-body text-ink marker:font-semibold marker:text-brand">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="grid list-disc gap-1.5 pl-5 text-body text-ink">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * The reviewer guide (NSTOCK-0280): a public, single-page tour of nthstock for people reviewing
 * the hosted demo. Static copy only; it reads no data, so it works logged in or out.
 */
export function GuidePage() {
  useDocumentTitle(strings.pageTitle);

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <PageHeader title={strings.title} description={strings.description} />

      <nav aria-label={strings.tocLabel} className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 text-label font-semibold text-ink-muted uppercase">
          {strings.tocLabel}
        </h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="rounded-sm text-body font-medium text-brand hover:underline"
              >
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <GuideSection id="what">
        <div className="grid gap-3 text-body text-ink">
          {strings.intro.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </GuideSection>

      <GuideSection id="try">
        <div className="grid gap-4">
          <dl
            aria-label={strings.tryIt.loginLabel}
            className="grid gap-3 rounded-md bg-brand-soft p-4 sm:grid-cols-3"
          >
            {strings.tryIt.login.map((row) => (
              <div key={row.term} className="grid gap-0.5">
                <dt className="text-label text-ink-muted">{row.term}</dt>
                <dd className="font-mono text-body font-semibold text-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
          <Steps steps={strings.tryIt.steps} />
          <p className="text-label text-ink-muted">{strings.tryIt.note}</p>
          <div>
            <Link to="/login" className={buttonVariants({ variant: 'primary' })}>
              {strings.tryIt.cta}
            </Link>
          </div>
        </div>
      </GuideSection>

      <GuideSection id="features">
        <ul className="grid gap-3 sm:grid-cols-2">
          {strings.features.list.map((feature) => (
            <li key={feature.name} className="grid gap-1 rounded-md border border-line p-3">
              <h3 className="text-body font-semibold text-ink">{feature.name}</h3>
              <p className="text-body text-ink-muted">{feature.body}</p>
            </li>
          ))}
        </ul>
      </GuideSection>

      <GuideSection id="buy">
        <Steps steps={strings.buy.steps} />
      </GuideSection>

      <GuideSection id="sell">
        <div className="grid gap-3">
          <Steps steps={strings.sell.steps} />
          <p className="text-label text-ink-muted">{strings.sell.note}</p>
        </div>
      </GuideSection>

      <GuideSection id="stack">
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {strings.stack.groups.map((group) => (
              <div key={group.name} className="grid content-start gap-2">
                <h3 className="text-body font-semibold text-ink">{group.name}</h3>
                <Bullets items={group.items} />
              </div>
            ))}
          </div>
          <p className="text-label text-ink-muted">{strings.stack.demoNote}</p>
        </div>
      </GuideSection>

      <GuideSection id="run">
        <div className="grid gap-4">
          <p className="text-body text-ink">
            {strings.run.body}{' '}
            <a
              href={strings.run.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm font-medium text-brand hover:underline"
            >
              {strings.run.repoLabel}
            </a>
          </p>
          <dl className="grid gap-3">
            {strings.run.commands.map((row) => (
              <div key={row.command} className="grid gap-1">
                <dt className="text-label text-ink-muted">{row.label}</dt>
                <dd>
                  <code className="block overflow-x-auto rounded-md bg-canvas px-3 py-2 font-mono text-label text-ink">
                    {row.command}
                  </code>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-label text-ink-muted">{strings.run.demoHint}</p>
        </div>
      </GuideSection>

      <GuideSection id="limits">
        <Bullets items={strings.limits.list} />
      </GuideSection>
    </div>
  );
}
