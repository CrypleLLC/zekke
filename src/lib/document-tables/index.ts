export const TABLE_PICKER_ROWS = 8;
export const TABLE_PICKER_COLUMNS = 10;
export const MAX_TABLE_ROWS = 100;
export const MAX_TABLE_COLUMNS = 20;
export const MIN_COLUMN_WIDTH_PX = 24;
export const MIN_ROW_HEIGHT_PX = 24;
export const MAX_ROW_HEIGHT_PX = 2000;

const PIXEL_LENGTH = /^(\d+(?:\.\d+)?)(?:px)?$/;

export function safeRowHeight(value: unknown): number | undefined {
  let pixels: number | undefined;
  if (typeof value === 'number') {
    pixels = value;
  } else if (typeof value === 'string') {
    const match = PIXEL_LENGTH.exec(value.trim());
    pixels = match === null ? undefined : Number(match[1]);
  }
  if (pixels === undefined || !Number.isFinite(pixels)) {
    return undefined;
  }
  const rounded = Math.round(pixels);
  return rounded >= MIN_ROW_HEIGHT_PX && rounded <= MAX_ROW_HEIGHT_PX ? rounded : undefined;
}

export function rowHeightAfterDrag(start: number, dragged: number, scale: number): number {
  const layout = start + dragged / (scale > 0 ? scale : 1);
  return Math.min(MAX_ROW_HEIGHT_PX, Math.max(MIN_ROW_HEIGHT_PX, Math.round(layout)));
}

export function clampTableSize(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(max, Math.max(1, Math.round(value)));
}

export function evenColumnWidths(total: number, count: number): number[] {
  const columns = Math.max(1, Math.round(count));
  const width = Math.max(columns * MIN_COLUMN_WIDTH_PX, Math.round(total));
  const base = Math.floor(width / columns);
  const remainder = width - base * columns;
  return Array.from({ length: columns }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function scaleColumnWidths(widths: readonly number[], total: number): number[] {
  if (widths.length === 0) {
    return [];
  }
  const current = widths.reduce((sum, width) => sum + width, 0);
  if (current <= 0) {
    return evenColumnWidths(total, widths.length);
  }
  const target = Math.max(widths.length * MIN_COLUMN_WIDTH_PX, Math.round(total));
  const scaled = widths.map((width) => Math.max(MIN_COLUMN_WIDTH_PX, Math.floor((width * target) / current)));
  let missing = target - scaled.reduce((sum, width) => sum + width, 0);
  for (let index = 0; missing > 0; index = (index + 1) % scaled.length) {
    scaled[index] += 1;
    missing -= 1;
  }
  return scaled;
}

export function dragColumnBorder(
  start: readonly number[],
  column: number,
  dragged: number,
  available: number,
): number[] {
  const widths = [...start];
  if (column < 0 || column >= widths.length || !Number.isFinite(dragged)) {
    return widths;
  }
  const own = start[column];

  if (column < widths.length - 1) {
    const pair = own + start[column + 1];
    const next = Math.min(pair - MIN_COLUMN_WIDTH_PX, Math.max(MIN_COLUMN_WIDTH_PX, Math.round(own + dragged)));
    widths[column] = next;
    widths[column + 1] = pair - next;
    return widths;
  }

  const others = start.reduce((sum, width) => sum + width, 0) - own;
  const ceiling = Math.max(MIN_COLUMN_WIDTH_PX, Math.floor(available) - others);
  widths[column] = Math.min(ceiling, Math.max(MIN_COLUMN_WIDTH_PX, Math.round(own + dragged)));
  return widths;
}

export function fitColumnWidths(widths: readonly number[], available: number): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  return total > available ? scaleColumnWidths(widths, available) : [...widths];
}
