/**
 * Placeholder root component, styled with token classes only. The app shell (header, rail,
 * routes) replaces it in T-022 to T-030.
 */
export function App() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-display text-brand">nthstock</h1>
      <p className="text-lg text-ink-muted">Indian stock market platform. Paper trading only.</p>
      <p className="mt-4 font-mono text-up">▲ 1.25%</p>
    </main>
  );
}
