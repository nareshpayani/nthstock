import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installOrderSoundUnlock,
  ORDER_SOUND_NOTES,
  orderSoundsEnabled,
  playOrderSound,
  resetOrderSoundsForTests,
  setOrderSoundsEnabled,
  subscribeOrderSounds,
} from './orderSounds';

function fakeAudioContext() {
  const oscillators: {
    frequency: { value: number };
    type: string;
    start: ReturnType<typeof vi.fn>;
  }[] = [];
  const param = () => ({
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  class FakeContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    resume = vi.fn(() => Promise.resolve());
    createBuffer = vi.fn(() => ({}));
    createBufferSource = vi.fn(() => ({ connect: vi.fn(), start: vi.fn(), buffer: null }));
    createGain = vi.fn(() => ({ gain: param(), connect: vi.fn() }));
    createOscillator = vi.fn(() => {
      const oscillator = {
        type: 'sine',
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(oscillator);
      return oscillator;
    });
  }
  return { FakeContext, oscillators };
}

describe('order sounds (A17)', () => {
  let fake: ReturnType<typeof fakeAudioContext>;

  beforeEach(() => {
    fake = fakeAudioContext();
    vi.stubGlobal('AudioContext', fake.FakeContext);
    window.localStorage.clear();
    resetOrderSoundsForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays silent until a gesture unlocks audio', () => {
    expect(playOrderSound('placed')).toBe(false);
    const teardown = installOrderSoundUnlock(window);
    window.dispatchEvent(new Event('pointerdown'));
    expect(playOrderSound('placed')).toBe(true);
    teardown();
  });

  it('plays each note of the cue: a buy fill rises, a sell fill falls', () => {
    installOrderSoundUnlock(window);
    window.dispatchEvent(new Event('keydown'));
    playOrderSound('filledBuy');
    const buy = fake.oscillators.map((oscillator) => oscillator.frequency.value);
    expect(buy).toEqual(ORDER_SOUND_NOTES.filledBuy.map((note) => note.hz));
    expect(buy[1]).toBeGreaterThan(buy[0] ?? 0);
    fake.oscillators.length = 0;
    playOrderSound('filledSell');
    const sell = fake.oscillators.map((oscillator) => oscillator.frequency.value);
    expect(sell[1]).toBeLessThan(sell[0] ?? 0);
  });

  it('never plays when muted, remembers the setting and tells subscribers', () => {
    installOrderSoundUnlock(window);
    window.dispatchEvent(new Event('pointerdown'));
    const listener = vi.fn();
    subscribeOrderSounds(listener);
    setOrderSoundsEnabled(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(playOrderSound('placed')).toBe(false);
    resetOrderSoundsForTests();
    expect(orderSoundsEnabled()).toBe(false);
    setOrderSoundsEnabled(true);
    expect(orderSoundsEnabled()).toBe(true);
  });

  it('does nothing where the browser has no Web Audio', () => {
    vi.stubGlobal('AudioContext', undefined);
    installOrderSoundUnlock(window);
    window.dispatchEvent(new Event('pointerdown'));
    expect(playOrderSound('rejected')).toBe(false);
  });
});
