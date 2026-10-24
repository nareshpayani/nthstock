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

/** Tailwind's `lg`: from here the tab list is the left column, where the app's rail sits. */
const SIDE_TABS_QUERY = '(min-width: 1024px)';

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
    <Tabs
      ref={top}
      value={current.id}
      onValueChange={onSelectTab}
      orientation={sideTabs ? 'vertical' : 'horizontal'}
      // Phones and tablets: title, a sticky strip of topics, then the topic. From 1024 px the
      // topics are the page's left column, in the place of the app's watchlist rail, and the
      // topic fills the rest of the screen.
      className="grid scroll-mt-[calc(var(--header-h)+1rem)] gap-4 [grid-template-areas:'header'_'tabs'_'body'] lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-x-0 lg:gap-y-6 lg:[grid-template-areas:'tabs_header'_'tabs_body']"
    >
      <div className="[grid-area:header] lg:px-8 lg:pt-6">
        <PageHeader
          title={strings.title}
          description={strings.description}
          actions={
            <Link to="/login" className={buttonVariants({ variant: 'primary' })}>
              {strings.headerCta}
            </Link>
          }
        />
      </div>

      <TabsList
        ref={list}
        aria-label={strings.tabsLabel}
        className="sticky top-(--header-h) z-10 bg-canvas [grid-area:tabs] lg:h-[calc(100dvh-var(--header-h))] lg:flex-col lg:gap-0.5 lg:self-start lg:overflow-y-auto lg:border-r lg:border-b-0 lg:bg-surface lg:p-3"
      >
        {TABS.map((item) => (
          <TabsTrigger
            key={item.id}
            value={item.id}
            className="min-h-11 lg:mb-0 lg:rounded-md lg:border-b-0 lg:px-3 lg:py-2 lg:text-left lg:whitespace-normal lg:hover:bg-canvas lg:data-[state=active]:bg-brand-soft"
          >
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="min-w-0 [grid-area:body] lg:px-8 lg:pb-8">
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
      </div>
    </Tabs>
  );
}
