import { safeColor } from '@/lib/document-styles';
import type { HorizontalPlacement } from './print-layout';

export type BorderSide = 'top' | 'right' | 'bottom' | 'left';
export type VerticalPlacement = 'top' | 'middle' | 'bottom';
export type ValueKind = 'number' | 'boolean' | 'text';

export interface BorderLine {
  width: number;
  style: 'solid' | 'dashed' | 'dotted' | 'double';
  color: string;
}

export interface CellLook {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  background?: string;
  horizontal: HorizontalPlacement;
  vertical: VerticalPlacement;
  wrap: boolean;
  borders: Partial<Record<BorderSide, BorderLine>>;
  padding: Record<BorderSide, number>;
}

export const DEFAULT_CELL_FONT = 'Arial';
export const DEFAULT_CELL_FONT_SIZE = 11;
export const DEFAULT_CELL_COLOR = '#000000';
const DEFAULT_PADDING: Record<BorderSide, number> = { top: 0, right: 2, bottom: 2, left: 2 };
const FONT_NAME = /^[\p{L}\p{N} _.-]{1,64}$/u;
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
const BORDER_SIDES: Record<string, BorderSide> = { t: 'top', r: 'right', b: 'bottom', l: 'left' };

const BORDER_STYLES: Record<number, Omit<BorderLine, 'color'>> = {
  1: { width: 1, style: 'solid' },
  2: { width: 0.5, style: 'solid' },
  3: { width: 1, style: 'dotted' },
  4: { width: 1, style: 'dashed' },
  5: { width: 1, style: 'dashed' },
  6: { width: 1, style: 'dashed' },
  7: { width: 3, style: 'double' },
  8: { width: 2, style: 'solid' },
  9: { width: 2, style: 'dashed' },
  10: { width: 2, style: 'dashed' },
  11: { width: 2, style: 'dashed' },
  12: { width: 2, style: 'dashed' },
  13: { width: 3, style: 'solid' },
};

const HORIZONTAL: Record<number, HorizontalPlacement> = { 1: 'left', 2: 'center', 3: 'right', 4: 'justify', 5: 'justify', 6: 'justify' };
const VERTICAL: Record<number, VerticalPlacement> = { 1: 'top', 2: 'middle', 3: 'bottom' };
const WRAP = 3;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function colorOf(value: unknown): string | undefined {
  return safeColor(record(value).rgb);
}

function flag(value: unknown): boolean {
  return value === 1 || value === true;
}

function decoration(value: unknown): boolean {
  return flag(record(value).s);
}

export function safeCellFont(value: unknown): string {
  const names = (typeof value === 'string' ? value : '')
    .split(',')
    .map((name) => name.trim().replace(/^["']|["']$/g, ''))
    .filter((name) => FONT_NAME.test(name));
  const families = names.map((name) => (GENERIC_FAMILIES.has(name.toLowerCase()) ? name.toLowerCase() : `"${name}"`));
  if (families.length === 0) {
    families.push(`"${DEFAULT_CELL_FONT}"`);
  }
  return [...new Set([...families, 'sans-serif'])].join(', ');
}

function fontSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(409, Math.max(1, value)) : DEFAULT_CELL_FONT_SIZE;
}

function padding(value: unknown): Record<BorderSide, number> {
  const stored = record(value);
  const side = (key: string, fallback: number) => {
    const number = stored[key];
    return typeof number === 'number' && Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : fallback;
  };
  return {
    top: side('t', DEFAULT_PADDING.top),
    right: side('r', DEFAULT_PADDING.right),
    bottom: side('b', DEFAULT_PADDING.bottom),
    left: side('l', DEFAULT_PADDING.left),
  };
}

function borders(value: unknown): Partial<Record<BorderSide, BorderLine>> {
  const stored = record(value);
  const result: Partial<Record<BorderSide, BorderLine>> = {};
  for (const [key, side] of Object.entries(BORDER_SIDES)) {
    const border = record(stored[key]);
    const kind = typeof border.s === 'number' ? BORDER_STYLES[border.s] : undefined;
    if (kind !== undefined) {
      result[side] = { ...kind, color: colorOf(border.cl) ?? DEFAULT_CELL_COLOR };
    }
  }
  return result;
}

export function defaultHorizontal(kind: ValueKind): HorizontalPlacement {
  return kind === 'number' ? 'right' : kind === 'boolean' ? 'center' : 'left';
}

export function cellLook(style: unknown, kind: ValueKind): CellLook {
  const stored = record(style);
  const look: CellLook = {
    fontFamily: safeCellFont(stored.ff),
    fontSize: fontSize(stored.fs),
    bold: flag(stored.bl),
    italic: flag(stored.it),
    underline: decoration(stored.ul),
    strike: decoration(stored.st),
    color: colorOf(stored.cl) ?? DEFAULT_CELL_COLOR,
    horizontal: (typeof stored.ht === 'number' ? HORIZONTAL[stored.ht] : undefined) ?? defaultHorizontal(kind),
    vertical: (typeof stored.vt === 'number' ? VERTICAL[stored.vt] : undefined) ?? 'bottom',
    wrap: stored.tb === WRAP,
    borders: borders(stored.bd),
    padding: padding(stored.pd),
  };
  const background = colorOf(stored.bg);
  if (background !== undefined) {
    look.background = background;
  }
  return look;
}

export function isDecorated(look: CellLook): boolean {
  return look.background !== undefined || Object.keys(look.borders).length > 0;
}
