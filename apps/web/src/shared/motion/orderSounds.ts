import { safeStorage } from '../lib/safeStorage';

/**
 * Order sounds (A17): a short, soft cue when an order is placed, fills, a trailing stop is set or
 * an order is refused. Synthesised with the Web Audio API, so there is nothing to download. A buy
 * fill rises, a sell fill falls, a refusal is two low notes. Like haptics they never carry meaning
 * alone: every cue marks something already shown in words. The user can mute them
 * (`setOrderSoundsEnabled`), and iPhone Safari stays silent while the ring switch is on silent.
 *
 * Browsers only let a page make sound after a user gesture, so `installOrderSoundUnlock` opens the
 * audio context on the first tap or key press; a cue before that is skipped.
 */
export type OrderSound = 'placed' | 'filledBuy' | 'filledSell' | 'stopSet' | 'rejected';

type Note = { readonly hz: number; readonly at: number; readonly length: number };

/** Each cue's notes: pitch in Hz, start and length in seconds. All under 0.4 s. */
export const ORDER_SOUND_NOTES: Readonly<Record<OrderSound, readonly Note[]>> = {
  placed: [{ hz: 880, at: 0, length: 0.14 }],
  filledBuy: [
    { hz: 784, at: 0, length: 0.11 },
    { hz: 1175, at: 0.09, length: 0.24 },
  ],
  filledSell: [
    { hz: 1175, at: 0, length: 0.11 },
    { hz: 784, at: 0.09, length: 0.24 },
  ],
  stopSet: [
    { hz: 988, at: 0, length: 0.08 },
    { hz: 988, at: 0.11, length: 0.14 },
  ],
  rejected: [
    { hz: 247, at: 0, length: 0.13 },
    { hz: 196, at: 0.15, length: 0.2 },
  ],
};

/** Peak gain: quiet enough not to startle in a meeting, loud enough to hear in a pocket. */
const PEAK_GAIN = 0.12;
const ATTACK_S = 0.012;

const STORAGE_KEY = 'nthstock.sounds';

let enabledSetting: boolean | undefined;
const listeners = new Set<() => void>();

export function orderSoundsEnabled(): boolean {
  enabledSetting ??= safeStorage.get(STORAGE_KEY) !== 'off';
  return enabledSetting;
}

export function setOrderSoundsEnabled(enabled: boolean): void {
  enabledSetting = enabled;
  if (enabled) safeStorage.remove(STORAGE_KEY);
  else safeStorage.set(STORAGE_KEY, 'off');
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`: every mute switch on screen stays in step. */
export function subscribeOrderSounds(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let context: AudioContext | undefined;

function audioContextClass(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  // Safari before 14.1 only has the prefixed constructor.
  const prefixed = (window as Window & { webkitAudioContext?: typeof AudioContext })
    .webkitAudioContext;
  return window.AudioContext ?? prefixed;
}

/**
 * Opens (or resumes) the audio context inside a user gesture, and plays one silent sample, which is
 * what unlocks audio on iPhone Safari. Safe to call repeatedly.
 */
export function unlockOrderSounds(): void {
  try {
    if (!context) {
      const Context = audioContextClass();
      if (!Context) return;
      context = new Context();
    }
    if (context.state === 'suspended') void context.resume();
    const silent = context.createBufferSource();
    silent.buffer = context.createBuffer(1, 1, 22050);
    silent.connect(context.destination);
    silent.start(0);
  } catch {
    // Sound is a garnish; a browser that refuses audio still trades.
  }
}

/** Unlocks audio on the first tap or key press, then stops listening. Returns the teardown. */
export function installOrderSoundUnlock(target: Window = window): () => void {
  const events = ['pointerdown', 'keydown'] as const;
  const remove = () => {
    for (const event of events) target.removeEventListener(event, onGesture, true);
  };
  function onGesture() {
    unlockOrderSounds();
    remove();
  }
  for (const event of events) target.addEventListener(event, onGesture, true);
  return remove;
}

/**
 * Plays `sound` if audio is unlocked and the user has not muted order sounds. Returns whether it
 * was scheduled. Never throws.
 */
export function playOrderSound(sound: OrderSound): boolean {
  if (!orderSoundsEnabled() || !context) return false;
  try {
    if (context.state === 'suspended') void context.resume();
    const start = context.currentTime + 0.01;
    for (const note of ORDER_SOUND_NOTES[sound]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      // A refusal is a softer, rounder triangle; everything else a pure sine.
      oscillator.type = sound === 'rejected' ? 'triangle' : 'sine';
      oscillator.frequency.value = note.hz;
      const at = start + note.at;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + ATTACK_S);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + note.length);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + note.length + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}

/** Test seam: forget the context and the setting. */
export function resetOrderSoundsForTests(): void {
  context = undefined;
  enabledSetting = undefined;
  listeners.clear();
}
