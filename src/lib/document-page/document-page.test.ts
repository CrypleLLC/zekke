import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_MARGINS,
  LEGACY_PAGE_MARGINS,
  MIN_TEXT_MM,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  marginLabel,
  maxMargin,
  millimetresFromPixels,
  moveMargin,
  PAGE_WIDTH_PX,
  pageMarginVariables,
  pageScaleFor,
  pixelsFromMillimetres,
  pageMargins,
  printPageRule,
  sameMargins,
  snapMargin,
} from './index';

describe('the default margins', () => {
  it('are 3 cm top and left, 2 cm right and bottom', () => {
    expect(DEFAULT_PAGE_MARGINS).toEqual({ top: 30, right: 20, bottom: 20, left: 30 });
  });

  it('keep the inch every document had before margins could be set', () => {
    expect(LEGACY_PAGE_MARGINS).toEqual({ top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 });
  });
});

describe('reading stored margins', () => {
  it('keeps margins that leave room for text', () => {
    expect(pageMargins({ top: 30, right: 20, bottom: 20, left: 30 })).toEqual(DEFAULT_PAGE_MARGINS);
    expect(pageMargins({ top: 0, right: 0, bottom: 0, left: 0 })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('falls back to the legacy inch for anything else', () => {
    for (const stored of [
      undefined,
      null,
      '30mm',
      { top: 30, right: 20, bottom: 20 },
      { top: 30, right: 20, bottom: 20, left: '30' },
      { top: -1, right: 20, bottom: 20, left: 30 },
      { top: 30, right: 20, bottom: 20, left: Number.NaN },
      { top: 30, right: 100, bottom: 20, left: 100 },
      { top: 150, right: 20, bottom: 150, left: 30 },
    ]) {
      expect(pageMargins(stored)).toEqual(LEGACY_PAGE_MARGINS);
    }
  });

  it('rounds to a tenth of a millimetre', () => {
    expect(pageMargins({ top: 30.04, right: 20, bottom: 20, left: 30 }).top).toBe(30);
  });
});

describe('moving a margin', () => {
  it('moves one side and leaves the others', () => {
    expect(moveMargin(DEFAULT_PAGE_MARGINS, 'left', 45)).toEqual({ ...DEFAULT_PAGE_MARGINS, left: 45 });
  });

  it('never goes below zero', () => {
    expect(moveMargin(DEFAULT_PAGE_MARGINS, 'top', -12).top).toBe(0);
  });

  it('always leaves the minimum text block between a side and its opposite', () => {
    const left = moveMargin(DEFAULT_PAGE_MARGINS, 'left', 500).left;
    expect(left).toBe(PAGE_WIDTH_MM - MIN_TEXT_MM - DEFAULT_PAGE_MARGINS.right);
    const bottom = moveMargin(DEFAULT_PAGE_MARGINS, 'bottom', 500).bottom;
    expect(bottom).toBe(PAGE_HEIGHT_MM - MIN_TEXT_MM - DEFAULT_PAGE_MARGINS.top);
    expect(maxMargin(DEFAULT_PAGE_MARGINS, 'right')).toBe(130);
  });

  it('returns the same object when nothing moved, so a drag that ends in place writes nothing', () => {
    expect(moveMargin(DEFAULT_PAGE_MARGINS, 'top', 30)).toBe(DEFAULT_PAGE_MARGINS);
    expect(moveMargin(DEFAULT_PAGE_MARGINS, 'top', Number.NaN)).toBe(DEFAULT_PAGE_MARGINS);
  });

  it('snaps to the step and converts CSS pixels to millimetres', () => {
    expect(snapMargin(31.2, 2.5)).toBe(30);
    expect(snapMargin(31.3, 2.5)).toBe(32.5);
    expect(snapMargin(31.3, 0.5)).toBe(31.5);
    expect(millimetresFromPixels(96)).toBeCloseTo(25.4);
  });

  it('compares margins side by side', () => {
    expect(sameMargins(DEFAULT_PAGE_MARGINS, { ...DEFAULT_PAGE_MARGINS })).toBe(true);
    expect(sameMargins(DEFAULT_PAGE_MARGINS, LEGACY_PAGE_MARGINS)).toBe(false);
  });
});

describe('rendering margins', () => {
  it('labels them in centimetres', () => {
    expect(marginLabel(30)).toBe('3 cm');
    expect(marginLabel(32.5)).toBe('3.25 cm');
    expect(marginLabel(25.4)).toBe('2.54 cm');
    expect(marginLabel(25.4, 'imperial')).toBe('1 in');
    expect(marginLabel(19.1, 'imperial')).toBe('0.75 in');
  });

  it('writes the CSS properties the page reads', () => {
    expect(pageMarginVariables(DEFAULT_PAGE_MARGINS)).toEqual({
      '--doc-margin-top': '30mm',
      '--doc-margin-right': '20mm',
      '--doc-margin-bottom': '20mm',
      '--doc-margin-left': '30mm',
    });
  });

  it('writes the print rule in CSS box order', () => {
    expect(printPageRule(DEFAULT_PAGE_MARGINS)).toBe('@page { size: A4; margin: 30mm 20mm 20mm 30mm; }');
  });
});

describe('fitting the page to a narrow screen', () => {
  it('draws the page at full size wherever it fits', () => {
    expect(pageScaleFor(PAGE_WIDTH_PX)).toBe(1);
    expect(pageScaleFor(1400)).toBe(1);
  });

  it('scales it down to the width available, never past it', () => {
    const scale = pageScaleFor(390);
    expect(scale).toBeCloseTo(390 / PAGE_WIDTH_PX, 3);
    expect(PAGE_WIDTH_PX * scale).toBeLessThanOrEqual(390);
  });

  it('treats an unmeasured width as full size', () => {
    expect(pageScaleFor(0)).toBe(1);
    expect(pageScaleFor(Number.NaN)).toBe(1);
  });

  it('converts both ways at 96 CSS pixels per inch', () => {
    expect(pixelsFromMillimetres(25.4)).toBeCloseTo(96);
    expect(PAGE_WIDTH_PX).toBeCloseTo(793.7, 1);
  });
});
