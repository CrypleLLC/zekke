import { describe, expect, it } from 'vitest';
import { MENU_VIEWPORT_MARGIN_PX, placeMenuAt } from './index';

const menu = { width: 200, height: 240 };
const viewport = { width: 1000, height: 800 };

describe('placing a context menu', () => {
  it('opens at the pointer, down and to the right, when it fits', () => {
    expect(placeMenuAt({ x: 100, y: 100 }, menu, viewport)).toEqual({ left: 100, top: 100 });
  });

  it('opens to the left of the pointer near the right edge', () => {
    expect(placeMenuAt({ x: 950, y: 100 }, menu, viewport)).toEqual({ left: 750, top: 100 });
  });

  it('opens above the pointer near the bottom edge', () => {
    expect(placeMenuAt({ x: 100, y: 700 }, menu, viewport)).toEqual({ left: 100, top: 460 });
  });

  it('never leaves the viewport, even when it is larger than the room on both sides', () => {
    const placed = placeMenuAt({ x: 150, y: 150 }, menu, { width: 300, height: 300 });
    expect(placed.left).toBeGreaterThanOrEqual(MENU_VIEWPORT_MARGIN_PX);
    expect(placed.top).toBeGreaterThanOrEqual(MENU_VIEWPORT_MARGIN_PX);
    expect(placed.left + menu.width).toBeLessThanOrEqual(300 - MENU_VIEWPORT_MARGIN_PX);
  });
});
