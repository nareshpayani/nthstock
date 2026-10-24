import { Button, Tabs, TabsContent, TabsList, TabsTrigger, buttonVariants } from '@nthstock/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { PageHeader } from '@/shared/components/PageHeader';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { useMediaQuery } from '@/shared/hooks/usePhoneLayout';
import { neighboursOf, resolveTab } from '../model/guideContent';
import { strings } from '../strings';
import { GuideBlocks } from './GuideBlocks';

const TABS = strings.tabs;

/** Tailwind's `xl`: from here the tab list is a column beside the content. */
const SIDE_TABS_QUERY = '(min-width: 1280px)';

export type GuidePageProps = {
  /** The `?tab=` value; a missing or unknown one shows the first tab. */
  tab?: string | undefined;
  /** Called with a tab id when the reader picks a tab; the route puts it in the URL. */
  onSelectTab: (id: string) => void;
};

/**
 * The reviewer guide (NSTOCK-0280, tabbed in NSTOCK-0341): a public tour of nthstock from the
 * product down to the code, one tab per topic, each deep-linkable as `/guide?tab=<id>`. Static
 * copy only; it reads no data, so it works logged in or out.
 */
export function GuidePage({ tab, onSelectTab }: GuidePageProps) {
  const current = resolveTab(TABS, tab);
  useDocumentTitle(
    current.id === TABS[0].id ? strings.pageTitle : `${current.label} · ${strings.pageTitle}`,
  );
  const sideTabs = useMediaQuery(SIDE_TABS_QUERY);
  const top = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { previous, next } = neighboursOf(TABS, current.id);
  const list = useRef<HTMLDivElement>(null);

  // On a phone the tab list scrolls sideways: keep the open tab in view, also after a deep link.
  useEffect(() => {
    const strip = list.current;
    const active = strip?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!strip || !active || sideTabs) return;
    strip.scrollLeft = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
  }, [current.id, sideTabs]);

  /** The pager moves focus to the new panel's heading and brings it into view. */
  const goTo = (id: string) => {
    onSelectTab(id);
    requestAnimationFrame(() => {
      top.current?.scrollIntoView({ block: 'start' });
      heading.current?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader
        title={strings.title}
        description={strings.description}
        actions={
          <Link to="/login" className={buttonVariants({ variant: 'primary' })}>
            {strings.headerCta}
          </Link>
        }
      />

      <div ref={top} className="scroll-mt-[calc(var(--header-h)+1rem)]" />
      <Tabs
        value={current.id}
        onValueChange={onSelectTab}
        orientation={sideTabs ? 'vertical' : 'horizontal'}
        className="grid gap-4 xl:grid-cols-[13rem_minmax(0,1fr)] xl:items-start xl:gap-6"
      >
        <TabsList
          ref={list}
          aria-label={strings.tabsLabel}
          className="sticky top-(--header-h) z-10 bg-canvas xl:top-[calc(var(--header-h)+1.5rem)] xl:flex-col xl:gap-0 xl:border-b-0 xl:border-l"
        >
          {TABS.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              className="min-h-11 xl:mb-0 xl:-ml-px xl:border-b-0 xl:border-l-2 xl:px-3 xl:py-2 xl:text-left xl:whitespace-normal"
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((item) => (
          <TabsContent key={item.id} value={item.id} className="min-w-0 pt-0">
            <article className="grid gap-5 rounded-lg border border-line bg-surface p-4 lg:p-6">
              <header className="grid gap-1">
                <h2
                  ref={item.id === current.id ? heading : undefined}
                  tabIndex={-1}
                  className="text-title text-ink outline-none"
                >
                  {item.title}
                </h2>
                <p className="text-body text-ink-muted">{item.summary}</p>
              </header>
              <GuideBlocks blocks={item.blocks} />
              <nav
                aria-label={strings.pagerLabel}
                className="flex flex-wrap justify-between gap-3 border-t border-line pt-4"
              >
                {previous ? (
                  <Button variant="secondary" onClick={() => goTo(previous.id)}>
                    {`← ${strings.previous}: ${previous.label}`}
                  </Button>
                ) : (
                  <span />
                )}
                {next ? (
                  <Button variant="primary" onClick={() => goTo(next.id)}>
                    {`${strings.next}: ${next.label} →`}
                  </Button>
                ) : null}
              </nav>
            </article>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
