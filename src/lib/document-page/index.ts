export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type MarginSide = keyof PageMargins;

export const MARGIN_SIDES: readonly MarginSide[] = ['top', 'right', 'bottom', 'left'];

export const PAGE_WIDTH_MM = 210;
export const PAGE_HEIGHT_MM = 297;
export const MIN_TEXT_MM = 50;
export const MARGIN_STEP_MM = 2.5;
export const MARGIN_FINE_STEP_MM = 0.5;
export const MARGIN_LARGE_STEP_MM = 10;

export const DEFAULT_PAGE_MARGINS: PageMargins = { top: 30, right: 20, bottom: 20, left: 30 };
export const LEGACY_PAGE_MARGINS: PageMargins = { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 };

const OPPOSITE: Record<MarginSide, MarginSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

const MILLIMETRES_PER_PIXEL = 25.4 / 96;

export function isVertical(side: MarginSide): boolean {
  return side === 'top' || side === 'bottom';
}

export function pageExtent(side: MarginSide): number {
  return isVertical(side) ? PAGE_HEIGHT_MM : PAGE_WIDTH_MM;
}

function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function maxMargin(margins: PageMargins, side: MarginSide): number {
  return tenth(pageExtent(side) - MIN_TEXT_MM - margins[OPPOSITE[side]]);
}

export function moveMargin(margins: PageMargins, side: MarginSide, value: number): PageMargins {
  if (!Number.isFinite(value)) {
    return margins;
  }
  const clamped = Math.min(maxMargin(margins, side), Math.max(0, tenth(value)));
  return clamped === margins[side] ? margins : { ...margins, [side]: clamped };
}

export function snapMargin(value: number, step: number): number {
  return tenth(Math.round(value / step) * step);
}

export function millimetresFromPixels(pixels: number): number {
  return pixels * MILLIMETRES_PER_PIXEL;
}

export function pixelsFromMillimetres(millimetres: number): number {
  return millimetres / MILLIMETRES_PER_PIXEL;
}

export const PAGE_WIDTH_PX = pixelsFromMillimetres(PAGE_WIDTH_MM);

export function pageScaleFor(availableWidth: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return 1;
  }
  return Math.min(1, Math.floor((availableWidth / PAGE_WIDTH_PX) * 10000) / 10000);
}

export function sameMargins(left: PageMargins, right: PageMargins): boolean {
  return MARGIN_SIDES.every((side) => left[side] === right[side]);
}

export function pageMargins(stored: unknown): PageMargins {
  if (typeof stored !== 'object' || stored === null) {
    return LEGACY_PAGE_MARGINS;
  }

  const record = stored as Record<string, unknown>;
  const read: Partial<PageMargins> = {};
  for (const side of MARGIN_SIDES) {
    const value = record[side];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return LEGACY_PAGE_MARGINS;
    }
    read[side] = tenth(value);
  }

  const margins = read as PageMargins;
  const fits =
    margins.left + margins.right <= PAGE_WIDTH_MM - MIN_TEXT_MM &&
    margins.top + margins.bottom <= PAGE_HEIGHT_MM - MIN_TEXT_MM;
  return fits ? margins : LEGACY_PAGE_MARGINS;
}

export type RulerSystem = 'metric' | 'imperial';

export interface RulerUnits {
  unit: 'cm' | 'in';
  millimetres: number;
  step: number;
  fine: number;
  large: number;
}

export const RULER_UNITS: Record<RulerSystem, RulerUnits> = {
  metric: { unit: 'cm', millimetres: 10, step: MARGIN_STEP_MM, fine: MARGIN_FINE_STEP_MM, large: MARGIN_LARGE_STEP_MM },
  imperial: { unit: 'in', millimetres: 25.4, step: 6.35, fine: 3.175, large: 25.4 },
};

export function marginLabel(millimetres: number, system: RulerSystem = 'metric'): string {
  const units = RULER_UNITS[system];
  const value = tenth(millimetres) / units.millimetres;
  return `${value.toLocaleString('en', { maximumFractionDigits: 2 })} ${units.unit}`;
}

export const MARGIN_NAMES: Record<MarginSide, string> = {
  top: 'Top margin',
  right: 'Right margin',
  bottom: 'Bottom margin',
  left: 'Left margin',
};

export function pageMarginVariables(margins: PageMargins): Record<string, string> {
  return Object.fromEntries(
    MARGIN_SIDES.map((side) => [`--doc-margin-${side}`, `${margins[side]}mm`]),
  );
}

export function printPageRule(margins: PageMargins): string {
  const box = MARGIN_SIDES.map((side) => `${margins[side]}mm`).join(' ');
  return `@page { size: A4; margin: ${box}; }`;
}

export type PaperSize = 'a4' | 'letter';
export type PageOrientation = 'portrait' | 'landscape';

export const PAPER_SIZES: Record<PaperSize, { width: number; height: number; css: string }> = {
  a4: { width: PAGE_WIDTH_MM, height: PAGE_HEIGHT_MM, css: 'A4' },
  letter: { width: 215.9, height: 279.4, css: 'letter' },
};

export function paperDimensions(paper: PaperSize, orientation: PageOrientation): { width: number; height: number } {
  const { width, height } = PAPER_SIZES[paper];
  return orientation === 'landscape' ? { width: height, height: width } : { width, height };
}

export function paperPageRule(paper: PaperSize, orientation: PageOrientation, margins: PageMargins): string {
  const box = MARGIN_SIDES.map((side) => `${tenth(margins[side])}mm`).join(' ');
  return `@page { size: ${PAPER_SIZES[paper].css} ${orientation}; margin: ${box}; }`;
}
