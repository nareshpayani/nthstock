import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverSnapshot, snapshotCaption, snapshotFileName } from './snapshot';

// 20:45:12 IST on 29 Oct 2026.
const AT = new Date('2026-10-29T15:15:12Z');

describe('chart snapshot (NSTOCK-0463)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('captions the image with what, when in IST, and the brand', () => {
    const caption = snapshotCaption(['INFY', '1D', undefined], AT);
    expect(caption).toMatch(/^INFY · 1D · 29 Oct 2026, 08:45:12 pm IST · nthstock$/i);
  });

  it('names the file by symbol and IST time', () => {
    expect(snapshotFileName('NIFTY 50', AT)).toBe('nthstock-NIFTY-50-20261029-2045.png');
  });

  it('opens the Share sheet on a phone that can share files', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
    const outcome = await deliverSnapshot(new Blob(['png']), 'a.png', { share: true });
    expect(outcome).toBe('shared');
    expect(share.mock.calls[0]?.[0].files[0].name).toBe('a.png');
  });

  it('treats a cancelled share as nothing went wrong', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('no', 'AbortError'));
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
    expect(await deliverSnapshot(new Blob(['png']), 'a.png', { share: true })).toBe('cancelled');
  });

  it('downloads on a desktop, or when sharing files is not offered', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, canShare: () => false, share: vi.fn() });
    expect(await deliverSnapshot(new Blob(['png']), 'a.png', { share: true })).toBe('downloaded');
    expect(await deliverSnapshot(new Blob(['png']), 'b.png', { share: false })).toBe('downloaded');
    expect(click).toHaveBeenCalledTimes(2);
  });
});
