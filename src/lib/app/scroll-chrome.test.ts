import { describe, expect, it } from 'vitest';
import { keyboardInset, nextQuickReturn, quickReturnStart, type QuickReturnState } from './index';

const OPTIONS = { threshold: 12, revealZone: 80 };

function scroll(from: QuickReturnState, ...positions: number[]): QuickReturnState {
  return positions.reduce((state, y) => nextQuickReturn(state, y, OPTIONS), from);
}

describe('the quick-return chrome', () => {
  it('stays shown near the top of the document', () => {
    expect(scroll(quickReturnStart(0), 20, 60, 80).hidden).toBe(false);
  });

  it('hides once the reader has scrolled down past the threshold', () => {
    expect(scroll(quickReturnStart(0), 100, 105).hidden).toBe(true);
  });

  it('ignores a scroll down shorter than the threshold', () => {
    const shown = scroll(quickReturnStart(200), 205, 210);
    expect(shown.hidden).toBe(false);
  });

  it('comes back on any scroll up past the threshold, far from the top', () => {
    const hidden = scroll(quickReturnStart(0), 2000, 4000);
    expect(hidden.hidden).toBe(true);
    expect(scroll(hidden, 3995).hidden).toBe(true);
    expect(scroll(hidden, 3995, 3985).hidden).toBe(false);
  });

  it('measures each direction from where it changed, not from the start', () => {
    const shown = scroll(quickReturnStart(0), 2000, 4000, 3900);
    expect(shown.hidden).toBe(false);
    expect(scroll(shown, 3905).hidden).toBe(false);
    expect(scroll(shown, 3905, 3915).hidden).toBe(true);
  });

  it('shows again whenever the reader is back at the top', () => {
    const hidden = scroll(quickReturnStart(0), 500, 1500);
    expect(scroll(hidden, 40).hidden).toBe(false);
  });

  it('leaves the state alone when the position has not changed', () => {
    const state = scroll(quickReturnStart(0), 500, 1500);
    expect(nextQuickReturn(state, 1500, OPTIONS)).toBe(state);
  });
});

describe('the keyboard inset', () => {
  it('is the part of the layout viewport the visual viewport no longer covers', () => {
    expect(keyboardInset(800, 460, 0)).toBe(340);
  });

  it('accounts for a visual viewport scrolled within the layout one', () => {
    expect(keyboardInset(800, 460, 100)).toBe(240);
  });

  it('is zero without a keyboard, or when the layout viewport already shrank', () => {
    expect(keyboardInset(800, 800, 0)).toBe(0);
    expect(keyboardInset(460, 460.4, 0)).toBe(0);
  });
});
