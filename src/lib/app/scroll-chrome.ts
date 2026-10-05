export interface QuickReturnState {
  hidden: boolean;
  last: number;
  travel: number;
}

export interface QuickReturnOptions {
  threshold: number;
  revealZone: number;
}

export const QUICK_RETURN_THRESHOLD_PX = 12;

export function quickReturnStart(scrollY: number): QuickReturnState {
  return { hidden: false, last: scrollY, travel: 0 };
}

export function nextQuickReturn(
  state: QuickReturnState,
  scrollY: number,
  options: QuickReturnOptions,
): QuickReturnState {
  if (scrollY <= options.revealZone) {
    return { hidden: false, last: scrollY, travel: 0 };
  }

  const delta = scrollY - state.last;
  if (delta === 0) {
    return state;
  }

  const sameDirection = Math.sign(delta) === Math.sign(state.travel);
  const travel = sameDirection ? state.travel + delta : delta;

  let hidden = state.hidden;
  if (travel >= options.threshold) {
    hidden = true;
  } else if (travel <= -options.threshold) {
    hidden = false;
  }

  return { hidden, last: scrollY, travel };
}

export function keyboardInset(
  layoutHeight: number,
  visualHeight: number,
  visualOffsetTop: number,
): number {
  return Math.max(0, Math.round(layoutHeight - visualHeight - visualOffsetTop));
}
