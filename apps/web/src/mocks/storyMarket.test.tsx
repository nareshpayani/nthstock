import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useQuote } from '@/shared/hooks/useQuote';
import { useMarketOpen } from '@/shared/hooks/useMarketOpen';
import { createStoryMarket, StoryProviders } from './storyMarket';

function Probe() {
  const live = useQuote('INFY');
  const open = useMarketOpen();
  return <p>{`${live ? 'priced' : 'waiting'} ${open ? 'open' : 'closed'}`}</p>;
}

describe('story market', () => {
  it('serves REST through the real market handlers, schema-checked', async () => {
    const { apiClient, adapter } = createStoryMarket();
    const indices = await apiClient.request('marketIndices');
    expect(indices.items.length).toBeGreaterThanOrEqual(5);
    await expect(
      apiClient.request('marketList', { params: { id: 'no-such-list' } }),
    ).rejects.toMatchObject({ status: 404 });
    adapter.dispose();
  });

  it('feeds subscribed symbols their snapshot quote and a fixed market session', async () => {
    render(
      <StoryProviders marketOpen>
        <Probe />
      </StoryProviders>,
    );
    expect(await screen.findByText('priced open')).toBeInTheDocument();
  });
});
