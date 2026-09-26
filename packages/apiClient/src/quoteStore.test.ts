import type { Exchange, Quote } from '@nthstock/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  animationFrameScheduler,
  createQuoteStore,
  quoteKey,
  type QuoteSource,
} from './quoteStore.js';
import { quote } from './test/fakes.js';

function fakeSource() {
  const subscribed = new Map<string, number>();
  let emit: (quotes: readonly Quote[]) => void = () => undefined;
  const source: QuoteSource = {
    subscribe(symbol: string, exchange: Exchange) {
      const key = quoteKey(symbol, exchange);
      subscribed.set(key, (subscribed.get(key) ?? 0) + 1);
      return () => subscribed.set(key, (subscribed.get(key) ?? 0) - 1);
    },
    onQuotes(listener) {
      emit = listener;
      return () => {
        emit = () => undefined;
      };
    },
  };
  return { source, subscribed, emit: (quotes: readonly Quote[]) => emit(quotes) };
}

function manualFrames() {
  const queue: (() => void)[] = [];
  return {
    schedule: (flush: () => void) => queue.push(flush),
    runFrame: () => queue.splice(0).forEach((flush) => flush()),
    pending: () => queue.length,
  };
}

describe('quote store', () => {
  it('100 ticks in one frame notify the subscribed symbol once and nobody else', () => {
    const frames = manualFrames();
    const { source, emit } = fakeSource();
    const store = createQuoteStore({ source, schedule: frames.schedule });
    const infy = vi.fn();
    const tcs = vi.fn();
    store.subscribe('INFY', 'NSE', infy);
    store.subscribe('TCS', 'NSE', tcs);

    for (let i = 1; i <= 100; i += 1) emit([quote('INFY', 150000 + i * 5)]);
    expect(frames.pending()).toBe(1);
    expect(infy).not.toHaveBeenCalled();
    frames.runFrame();
    expect(infy).toHaveBeenCalledTimes(1);
    expect(tcs).not.toHaveBeenCalled();
    expect(store.get('INFY')?.quote.ltp).toBe(150500);
  });

  it('keeps the same snapshot object until the next change', () => {
    const frames = manualFrames();
    const store = createQuoteStore({ schedule: frames.schedule });
    store.ingest([quote('INFY', 150000)]);
    frames.runFrame();
    const first = store.get('INFY');
    expect(store.get('INFY')).toBe(first);
    store.ingest([]);
    expect(frames.pending()).toBe(0);
    store.flush(); // nothing pending: no-op
    expect(store.get('INFY')).toBe(first);
  });

  it('tracks tick direction and a sequence that moves only when LTP changes', () => {
    const frames = manualFrames();
    const store = createQuoteStore({ schedule: frames.schedule });
    const step = (ltp: number) => {
      store.ingest([quote('INFY', ltp)]);
      frames.runFrame();
      const live = store.get('INFY');
      return [live?.tick, live?.seq];
    };
    expect(step(150000)).toEqual(['flat', 0]);
    expect(step(150005)).toEqual(['up', 1]);
    expect(step(150005)).toEqual(['up', 1]);
    expect(step(149995)).toEqual(['down', 2]);
  });

  it('keys by exchange so NSE and BSE listings do not collide', () => {
    const frames = manualFrames();
    const store = createQuoteStore({ schedule: frames.schedule });
    store.ingest([quote('SENSEX', 8200000, 'BSE')]);
    frames.runFrame();
    expect(store.get('SENSEX', 'BSE')?.quote.ltp).toBe(8200000);
    expect(store.get('SENSEX')).toBeUndefined();
  });

  it('subscribes the source on the first listener and releases on the last', () => {
    const { source, subscribed } = fakeSource();
    const store = createQuoteStore({ source, schedule: manualFrames().schedule });
    const offA = store.subscribe('INFY', 'NSE', vi.fn());
    const offB = store.subscribe('INFY', 'NSE', vi.fn());
    expect(subscribed.get('NSE:INFY')).toBe(1);
    expect(store.activeSymbols()).toEqual(['NSE:INFY']);
    offA();
    expect(subscribed.get('NSE:INFY')).toBe(1);
    offB();
    offB();
    expect(subscribed.get('NSE:INFY')).toBe(0);
    expect(store.activeSymbols()).toEqual([]);
  });

  it('dispose releases everything and ignores later quotes', () => {
    const frames = manualFrames();
    const { source, subscribed, emit } = fakeSource();
    const store = createQuoteStore({ source, schedule: frames.schedule });
    const listener = vi.fn();
    store.subscribe('INFY', 'NSE', listener);
    store.dispose();
    expect(subscribed.get('NSE:INFY')).toBe(0);
    emit([quote('INFY', 150000)]);
    store.ingest([quote('INFY', 150000)]);
    expect(frames.pending()).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('animationFrameScheduler', () => {
  it('uses requestAnimationFrame when present', () => {
    const raf = vi.fn((cb: () => void) => {
      cb();
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', raf);
    const flush = vi.fn();
    animationFrameScheduler(flush);
    expect(raf).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('falls back to a 16 ms timeout without it', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    animationFrameScheduler(flush);
    vi.advanceTimersByTime(15);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('is the default scheduler', () => {
    vi.useFakeTimers();
    const store = createQuoteStore();
    const listener = vi.fn();
    store.subscribe('INFY', 'NSE', listener);
    store.ingest([quote('INFY', 150000)]);
    vi.advanceTimersByTime(16);
    expect(listener).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe('quote store pause and resume (T-077)', () => {
  it('keeps only pinned symbols subscribed while paused and resubscribes on resume', () => {
    const { source, subscribed } = fakeSource();
    const store = createQuoteStore({ source, schedule: manualFrames().schedule });
    store.subscribe('INFY', 'NSE', () => undefined);
    store.subscribe('TCS', 'NSE', () => undefined);
    const unpin = store.pin('INFY', 'NSE');
    store.pin('INFY', 'NSE'); // pins are ref-counted
    store.pause();
    store.pause(); // idempotent
    expect(store.isPaused()).toBe(true);
    expect(Object.fromEntries(subscribed)).toEqual({ 'NSE:INFY': 1, 'NSE:TCS': 0 });

    // A symbol first watched while paused waits for resume unless pinned.
    store.subscribe('WIPRO', 'NSE', () => undefined);
    expect(subscribed.get('NSE:WIPRO')).toBeUndefined();
    store.pin('HDFCBANK', 'NSE');
    store.subscribe('HDFCBANK', 'NSE', () => undefined);
    expect(subscribed.get('NSE:HDFCBANK')).toBe(1);

    unpin();
    unpin(); // releasing twice is harmless
    expect(subscribed.get('NSE:INFY')).toBe(1); // still pinned once

    store.resume();
    store.resume();
    expect(store.isPaused()).toBe(false);
    expect(Object.fromEntries(subscribed)).toEqual({
      'NSE:INFY': 1,
      'NSE:TCS': 1,
      'NSE:WIPRO': 1,
      'NSE:HDFCBANK': 1,
    });
  });

  it('releases a pinned symbol on unpin while paused', () => {
    const { source, subscribed } = fakeSource();
    const store = createQuoteStore({ source, schedule: manualFrames().schedule });
    store.subscribe('INFY', 'NSE', () => undefined);
    const unpin = store.pin('INFY', 'NSE');
    store.pause();
    unpin();
    expect(subscribed.get('NSE:INFY')).toBe(0);
  });

  it('never lets an older quote replace a newer one', () => {
    const frames = manualFrames();
    const store = createQuoteStore({ schedule: frames.schedule });
    const newer = { ...quote('INFY', 151000), ts: '2026-09-25T04:00:02.000Z' };
    const older = { ...quote('INFY', 150000), ts: '2026-09-25T04:00:01.000Z' };
    store.ingest([newer]);
    store.ingest([older]); // older than pending
    frames.runFrame();
    store.ingest([older]); // older than committed: nothing is even scheduled
    expect(frames.pending()).toBe(0);
    expect(store.get('INFY')?.quote).toBe(newer);
  });
});
