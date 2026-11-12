export interface PreviewWheelGesture {
  accumulated: number;
  lastDirection: number;
  lastAt: number;
  lockedUntil: number;
  fired: boolean;
}

export const createPreviewWheelGesture = (): PreviewWheelGesture => ({ accumulated: 0, lastDirection: 0, lastAt: -Infinity, lockedUntil: 0, fired: false });

export const normalizePreviewWheel = (deltaY: number, deltaMode: number, pageHeight: number) => deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1);

/** One page per deliberate wheel gesture; the momentum tail never skips pages. */
export function consumePreviewWheel(previous: PreviewWheelGesture, deltaY: number, now: number): { state: PreviewWheelGesture; direction: -1 | 0 | 1 } {
  if (!Number.isFinite(deltaY) || deltaY === 0) return { state: previous, direction: 0 };
  const sign = Math.sign(deltaY);
  const restart = now - previous.lastAt > 180 || (previous.lastDirection !== 0 && sign !== previous.lastDirection);
  const state = { ...previous, accumulated: restart ? 0 : previous.accumulated, fired: restart ? false : previous.fired, lastAt: now, lastDirection: sign };
  if (state.fired || now < state.lockedUntil) return { state, direction: 0 };
  state.accumulated += deltaY;
  if (Math.abs(state.accumulated) < 60) return { state, direction: 0 };
  state.fired = true;
  state.accumulated = 0;
  state.lockedUntil = now + 250;
  return { state, direction: sign as -1 | 1 };
}

/** Include both ends and the current neighborhood without an unbounded dot rail. */
export function getPreviewPageWindow(current: number, total: number, limit = 7): number[] {
  const count = Math.max(1, Math.floor(total));
  const maximum = Math.max(3, Math.floor(limit));
  if (count <= maximum) return Array.from({ length: count }, (_, index) => index);
  const center = Math.max(0, Math.min(count - 1, Math.floor(current)));
  const windowSize = maximum - 2;
  const start = Math.max(1, Math.min(count - windowSize - 1, center - Math.floor(windowSize / 2)));
  return [0, ...Array.from({ length: windowSize }, (_, index) => start + index), count - 1];
}
