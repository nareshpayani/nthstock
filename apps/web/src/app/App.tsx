import { Button, ChangeBadge, IconPlus, Logo } from '@nthstock/ui';

/**
 * Placeholder root component, styled with token classes and @nthstock/ui only. The app shell
 * (header, rail, routes) replaces it in T-022 to T-030.
 */
export function App() {
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-8">
      <Logo />
      <h1 className="text-display text-ink">nthstock</h1>
      <p className="text-lg text-ink-muted">Indian stock market platform. Paper trading only.</p>
      <p>
        <ChangeBadge basisPoints={125} soft />
      </p>
      <p>
        <Button icon={<IconPlus size={16} />}>Add stock</Button>
      </p>
    </main>
  );
}
