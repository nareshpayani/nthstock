import { describe, expect, it, vi } from 'vitest';
import { createMemoryQuoteFeed } from './feed.js';
import { testQuote } from './test/quotes.js';

describe('createMemoryQuoteFeed', () => {
  it('emits to listeners until they detach or the feed closes', async () => {
    const feed = createMemoryQuoteFeed();
    const first = vi.fn();
    const second = vi.fn();
    const detach = feed.onQuotes(first);
    feed.onQuotes(second);
    feed.emit([testQuote('INFY', 150_000)]);
    detach();
    feed.emit([testQuote('INFY', 150_100)]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    await feed.close();
    expect(feed.closed).toBe(true);
    feed.emit([testQuote('INFY', 150_200)]);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
