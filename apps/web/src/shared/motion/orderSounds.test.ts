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

function fakeAudioContext({ compressor = true } = {}) {
  const oscillators: {
    frequency: { value: number };
    type: string;
    start: ReturnType<typeof vi.fn>;
  }[] = [];
  const gains: { gain: ReturnType<typeof param>; connect: ReturnType<typeof vi.fn> }[] = [];
  const compressors: { connect: ReturnType<typeof vi.fn> }[] = [];
  const knob = () => ({ value: 0 });
  const speakers = {};
  const param = () => ({
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const contexts: FakeContext[] = [];
  class FakeContext {
    constructor() {
      contexts.push(this);
    }
    state = 'running';
    currentTime = 0;
    destination = speakers;
    resume = vi.fn(() => Promise.resolve());
    createBuffer = vi.fn(() => ({}));
    createBufferSource = vi.fn(() => ({ connect: vi.fn(), start: vi.fn(), buffer: null }));
    createGain = vi.fn(() => {
      const gain = { gain: param(), connect: vi.fn() };
      gains.push(gain);
      return gain;
    });
    createDynamicsCompressor = compressor
      ? vi.fn(() => {
          const node = {
            threshold: knob(),
            knee: knob(),
            ratio: knob(),
            attack: knob(),
            release: knob(),
            connect: vi.fn(),
          };
          compressors.push(node);
          return node;
        })
      : undefined;
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
  return { FakeContext, oscillators, gains, compressors, speakers, contexts };
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

  it('is loud enough for a phone speaker: triangles at 0.7 through one compressor', () => {
    installOrderSoundUnlock(window);
    window.dispatchEvent(new Event('pointerdown'));
    playOrderSound('placed');
    playOrderSound('filledBuy');
    expect(fake.oscillators.map((oscillator) => oscillator.type)).toEqual([
      'triangle',
      'triangle',
      'triangle',
    ]);
    const peaks = fake.gains.map((gain) => gain.gain.linearRampToValueAtTime.mock.calls[0]?.[0]);
    expect(peaks).toEqual([0.7, 0.7, 0.7]);
    expect(fake.compressors).toHaveLength(1);
    const compressor = fake.compressors[0];
    for (const gain of fake.gains) expect(gain.connect).toHaveBeenCalledWith(compressor);
    expect(compressor?.connect).toHaveBeenCalledOnce();
    expect(compressor?.connect).toHaveBeenCalledWith(fake.speakers);
  });

  it('plays straight to the speakers where there is no compressor', () => {
    fake = fakeAudioContext({ compressor: false });
    vi.stubGlobal('AudioContext', fake.FakeContext);
    resetOrderSoundsForTests();
    installOrderSoundUnlock(window);
    window.dispatchEvent(new Event('pointerdown'));
    expect(playOrderSound('stopSet')).toBe(true);
    expect(fake.gains).toHaveLength(2);
    for (const gain of fake.gains) expect(gain.connect).toHaveBeenCalledWith(fake.speakers);
    expect(fake.compressors).toHaveLength(0);
  });

  it('keeps listening: a later tap wakes audio that the phone suspended', () => {
    const teardown = installOrderSoundUnlock(window);
    window.dispatchEvent(new Event('touchend'));
    const context = fake.contexts[0];
    expect(context).toBeDefined();
    expect(fake.contexts).toHaveLength(1);
    // A gesture while audio runs does no work. (Earlier tests' listeners are still on the window,
    // so counts are compared, not fixed.)
    const unlocks = () => context?.createBufferSource.mock.calls.length ?? 0;
    const before = unlocks();
    window.dispatchEvent(new Event('click'));
    expect(unlocks()).toBe(before);
    // iPhone Safari suspends audio after a call; the next tap resumes it.
    if (context) context.state = 'suspended';
    window.dispatchEvent(new Event('click'));
    expect(context?.resume).toHaveBeenCalled();
    expect(unlocks()).toBeGreaterThan(before);
    teardown();
  });

  it('does nothing where the browser has no Web Audio', () => {
    vi.stubGlobal('AudioContext', undefined);
    installOrderSoundUnlock(window);
    window.dispatchEvent(new Event('pointerdown'));
    expect(playOrderSound('rejected')).toBe(false);
  });
});
