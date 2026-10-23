import { describe, expect, it } from 'vitest';
import { IDLE, cancel, move, press, release, type HandleGesture } from './handleGesture';

const priceAt = (y: number) => 1_000 - y;

function run(...steps: ((g: HandleGesture) => { gesture: HandleGesture; effect: unknown })[]) {
  let gesture: HandleGesture = IDLE;
  const effects: unknown[] = [];
  for (const step of steps) {
    const next = step(gesture);
    gesture = next.gesture;
    effects.push(next.effect);
  }
  return { gesture, effects: effects.filter((e) => (e as { kind: string }).kind !== 'none') };
}

describe('handle gestures (T15, SPEC-TFC-1 §9.1)', () => {
  it('a press that moves no more than 6 px is a tap', () => {
    const { effects, gesture } = run(
      (g) => press(g, 'a', 1, 100),
      (g) => move(g, 1, 105, priceAt),
      (g) => release(g, 1, 105),
    );
    expect(effects).toEqual([{ kind: 'tap', id: 'a' }]);
    expect(gesture).toBe(IDLE);
  });

  it('a drag follows the finger and saves once on release', () => {
    const { effects } = run(
      (g) => press(g, 'a', 1, 100),
      (g) => move(g, 1, 120, priceAt),
      (g) => move(g, 1, 140, priceAt),
      (g) => release(g, 1, 140),
    );
    expect(effects).toEqual([
      { kind: 'move', id: 'a', price: 880 },
      { kind: 'move', id: 'a', price: 860 },
      { kind: 'commit', id: 'a', price: 860 },
    ]);
  });

  it('a drag released back within 6 px of its start is cancelled', () => {
    const { effects } = run(
      (g) => press(g, 'a', 1, 100),
      (g) => move(g, 1, 130, priceAt),
      (g) => move(g, 1, 103, priceAt),
      (g) => release(g, 1, 103),
    );
    expect(effects.at(-1)).toEqual({ kind: 'cancel', id: 'a' });
  });

  it('a second finger or Escape cancels the drag; other pointers are ignored', () => {
    expect(
      run(
        (g) => press(g, 'a', 1, 100),
        (g) => move(g, 1, 130, priceAt),
        (g) => move(g, 2, 160, priceAt),
        (g) => press(g, 'a', 2, 160),
      ).effects.at(-1),
    ).toEqual({ kind: 'cancel', id: 'a' });
    expect(
      run(
        (g) => press(g, 'a', 1, 100),
        (g) => move(g, 1, 130, priceAt),
        (g) => cancel(g),
      ).effects.at(-1),
    ).toEqual({ kind: 'cancel', id: 'a' });
    expect(
      run(
        (g) => press(g, 'a', 1, 100),
        (g) => cancel(g),
      ).effects,
    ).toEqual([]);
  });

  it('ignores a move to where the chart has no price', () => {
    const { effects } = run(
      (g) => press(g, 'a', 1, 100),
      (g) => move(g, 1, 140, () => null),
    );
    expect(effects).toEqual([]);
  });
});
