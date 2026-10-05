import { CONTINUOUS_TEXT_WIDTH_PX } from './records';

export type ImageAlignment = 'left' | 'center' | 'right';

export const IMAGE_ALIGNMENTS: readonly ImageAlignment[] = ['left', 'center', 'right'];
export const MIN_IMAGE_SHARE = 0.05;
export const MAX_IMAGE_DIMENSION = 100_000;
export const MAX_ALT_TEXT_CHARACTERS = 500;

export function safeImageShare(value: unknown): number {
  const share = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof share !== 'number' || !Number.isFinite(share)) {
    return 1;
  }
  return Math.round(Math.min(1, Math.max(MIN_IMAGE_SHARE, share)) * 1000) / 1000;
}

export function safeImageAlignment(value: unknown): ImageAlignment {
  return IMAGE_ALIGNMENTS.includes(value as ImageAlignment) ? (value as ImageAlignment) : 'center';
}

export function safeImageDimension(value: unknown): number {
  const dimension = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  if (typeof dimension !== 'number' || !Number.isInteger(dimension) || dimension < 1) {
    return 1;
  }
  return Math.min(MAX_IMAGE_DIMENSION, dimension);
}

export function safeAltText(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_ALT_TEXT_CHARACTERS) : '';
}

export function initialImageShare(width: number, devicePixelRatio = 2): number {
  return safeImageShare(width / devicePixelRatio / CONTINUOUS_TEXT_WIDTH_PX);
}

export function resizedImageShare(
  startWidth: number,
  pointerDelta: number,
  textWidth: number,
  alignment: ImageAlignment,
  side: 'left' | 'right',
): number {
  if (textWidth <= 0) {
    return 1;
  }
  const outward = side === 'right' ? pointerDelta : -pointerDelta;
  const growth = alignment === 'center' ? outward * 2 : outward;
  return safeImageShare((startWidth + growth) / textWidth);
}
