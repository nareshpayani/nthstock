/** A press that moves less than this is a tap; more is a drag (SPEC-TFC-1 §9.1). */
export const DRAG_SLOP = 6;

export type HandleGesture =
  | { phase: 'idle' }
  | { phase: 'pressed'; id: string; pointerId: number; startY: number }
  | { phase: 'dragging'; id: string; pointerId: number; startY: number; price: number };

/** What a gesture step asks the overlay to do. */
export type GestureEffect =
  | { kind: 'none' }
  | { kind: 'move'; id: string; price: number }
  | { kind: 'commit'; id: string; price: number }
  | { kind: 'cancel'; id: string }
  | { kind: 'tap'; id: string };

export const IDLE: HandleGesture = { phase: 'idle' };
const NONE: GestureEffect = { kind: 'none' };

type Step = { gesture: HandleGesture; effect: GestureEffect };

/** A pointer goes down on a handle. A second finger during a gesture cancels it. */
export function press(gesture: HandleGesture, id: string, pointerId: number, y: number): Step {
  if (gesture.phase === 'idle') {
    return { gesture: { phase: 'pressed', id, pointerId, startY: y }, effect: NONE };
  }
  return gesture.pointerId === pointerId ? { gesture, effect: NONE } : cancel(gesture);
}

/** The pointer moves; `priceAt` turns a y into a snapped price. */
export function move(
  gesture: HandleGesture,
  pointerId: number,
  y: number,
  priceAt: (y: number) => number | null,
): Step {
  if (gesture.phase === 'idle' || gesture.pointerId !== pointerId) {
    return { gesture, effect: NONE };
  }
  if (gesture.phase === 'pressed' && Math.abs(y - gesture.startY) <= DRAG_SLOP) {
    return { gesture, effect: NONE };
  }
  const price = priceAt(y);
  if (price === null) return { gesture, effect: NONE };
  const { id, startY } = gesture;
  return {
    gesture: { phase: 'dragging', id, pointerId, startY, price },
    effect: { kind: 'move', id, price },
  };
}

/**
 * The pointer lifts. A press that never moved is a tap; a drag released back within the slop of
 * where it started is cancelled, so a hesitant drag never sends a change.
 */
export function release(gesture: HandleGesture, pointerId: number, y: number): Step {
  if (gesture.phase === 'idle' || gesture.pointerId !== pointerId) {
    return { gesture, effect: NONE };
  }
  if (gesture.phase === 'pressed')
    return { gesture: IDLE, effect: { kind: 'tap', id: gesture.id } };
  if (Math.abs(y - gesture.startY) <= DRAG_SLOP) return cancel(gesture);
  return { gesture: IDLE, effect: { kind: 'commit', id: gesture.id, price: gesture.price } };
}

/** Escape, a second finger, a lost pointer, or the line going away: restore the line. */
export function cancel(gesture: HandleGesture): Step {
  if (gesture.phase === 'dragging') {
    return { gesture: IDLE, effect: { kind: 'cancel', id: gesture.id } };
  }
  return { gesture: IDLE, effect: NONE };
}
