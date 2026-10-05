export interface StyleOption {
  label: string;
  value: string;
}

export type FontGroup = 'Classic' | 'Sans serif' | 'Serif' | 'Monospace' | 'Display';

export interface FontOption extends StyleOption {
  group: FontGroup;
}

export const FONT_GROUPS: readonly FontGroup[] = ['Classic', 'Sans serif', 'Serif', 'Monospace', 'Display'];

export const FONT_FAMILIES: readonly FontOption[] = [
  { label: 'Arial', value: 'Arial, var(--font-doc-arimo), sans-serif', group: 'Classic' },
  {
    label: 'Times New Roman',
    value: '"Times New Roman", var(--font-doc-tinos), serif',
    group: 'Classic',
  },
  { label: 'Courier New', value: '"Courier New", var(--font-doc-cousine), monospace', group: 'Classic' },
  { label: 'Inter', value: 'var(--font-sans)', group: 'Sans serif' },
  { label: 'Roboto', value: 'var(--font-doc-roboto), sans-serif', group: 'Sans serif' },
  { label: 'Open Sans', value: 'var(--font-doc-open-sans), sans-serif', group: 'Sans serif' },
  { label: 'Montserrat', value: 'var(--font-doc-montserrat), sans-serif', group: 'Sans serif' },
  { label: 'Nunito', value: 'var(--font-doc-nunito), sans-serif', group: 'Sans serif' },
  { label: 'Raleway', value: 'var(--font-doc-raleway), sans-serif', group: 'Sans serif' },
  { label: 'Work Sans', value: 'var(--font-doc-work-sans), sans-serif', group: 'Sans serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif', group: 'Serif' },
  { label: 'Merriweather', value: 'var(--font-doc-merriweather), serif', group: 'Serif' },
  { label: 'Lora', value: 'var(--font-doc-lora), serif', group: 'Serif' },
  { label: 'Playfair Display', value: 'var(--font-doc-playfair-display), serif', group: 'Serif' },
  { label: 'EB Garamond', value: 'var(--font-doc-eb-garamond), serif', group: 'Serif' },
  { label: 'Source Serif', value: 'var(--font-doc-source-serif), serif', group: 'Serif' },
  { label: 'Roboto Slab', value: 'var(--font-doc-roboto-slab), serif', group: 'Serif' },
  { label: 'JetBrains Mono', value: 'var(--font-mono)', group: 'Monospace' },
  { label: 'Roboto Mono', value: 'var(--font-doc-roboto-mono), monospace', group: 'Monospace' },
  { label: 'Fira Code', value: 'var(--font-doc-fira-code), monospace', group: 'Monospace' },
  { label: 'Oswald', value: 'var(--font-doc-oswald), sans-serif', group: 'Display' },
  { label: 'Caveat', value: 'var(--font-doc-caveat), cursive', group: 'Display' },
  { label: 'Dancing Script', value: 'var(--font-doc-dancing-script), cursive', group: 'Display' },
];

export const DEFAULT_DOCUMENT_FONT = FONT_FAMILIES[0].value;
export const LEGACY_DOCUMENT_FONT = 'var(--font-sans)';

export function documentBaseFont(stored: unknown): string {
  return safeFontFamily(stored) ?? LEGACY_DOCUMENT_FONT;
}

export const FONT_SIZE_MIN_PX = 8;
export const FONT_SIZE_MAX_PX = 96;
export const FONT_SIZES: readonly string[] = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 48, 56, 64, 72, 80, 88, 96,
].map((size) => `${size}px`);
export const DEFAULT_FONT_SIZE = '16px';

export const LINE_HEIGHTS: readonly StyleOption[] = [
  { label: 'Single', value: '1.3' },
  { label: 'Normal', value: '1.7' },
  { label: '1.5', value: '2' },
  { label: 'Double', value: '2.6' },
];
export const DEFAULT_LINE_HEIGHT = '1.7';

export const HIGHLIGHT_COLORS: readonly string[] = [
  '#fef08a', '#fde68a', '#fed7aa', '#fecaca', '#fecdd3', '#fbcfe8',
  '#f5d0fe', '#e9d5ff', '#ddd6fe', '#c7d2fe', '#bfdbfe', '#bae6fd',
  '#a5f3fc', '#99f6e4', '#a7f3d0', '#bbf7d0', '#d9f99d', '#e5e7eb',
];

export const TEXT_COLOR_COLUMNS = 10;
export const TEXT_COLORS: readonly string[] = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#f87171', '#fb923c', '#fbbf24', '#facc15', '#4ade80', '#2dd4bf', '#38bdf8', '#60a5fa', '#a78bfa', '#f472b6',
  '#dc2626', '#ea580c', '#d97706', '#ca8a04', '#16a34a', '#0d9488', '#0284c7', '#2563eb', '#7c3aed', '#db2777',
  '#991b1b', '#9a3412', '#92400e', '#854d0e', '#166534', '#115e59', '#075985', '#1e40af', '#5b21b6', '#9d174d',
];

const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const LONG_HEX = /^#[0-9a-f]{6}$/i;

export function pickerColor(value: unknown, fallback = '#000000'): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const color = value.trim();
  if (LONG_HEX.test(color)) {
    return color.toLowerCase();
  }
  const short = SHORT_HEX.exec(color);
  return short === null
    ? fallback
    : `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
}

const MAX_STYLE_VALUE_LENGTH = 64;
const PIXEL_SIZE = /^([1-9]\d{0,2})px$/;
const TYPED_SIZE = /^(\d+(?:[.,]\d+)?|[.,]\d+)\s*(?:px)?$/i;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAMED_COLOR = /^[a-z]{3,20}$/i;
const CSS_NUMBER = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:%|deg)?`;
const FUNCTIONAL_COLOR = new RegExp(
  String.raw`^(?:rgba?|hsla?)\(\s*${CSS_NUMBER}(?:(?:\s*[,/]\s*|\s+)${CSS_NUMBER}){2,3}\s*\)$`,
  'i',
);

export function styleDeclaration(style: string | null, property: string): string | undefined {
  if (style === null) {
    return undefined;
  }

  const wanted = property.toLowerCase();
  const declarations = style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.length > 0);

  for (let index = declarations.length - 1; index >= 0; index -= 1) {
    const declaration = declarations[index];
    const colon = declaration.indexOf(':');
    if (colon !== -1 && declaration.slice(0, colon).trim().toLowerCase() === wanted) {
      return declaration.slice(colon + 1).trim();
    }
  }

  return undefined;
}

function candidate(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > MAX_STYLE_VALUE_LENGTH ? undefined : trimmed;
}

export function safeColor(value: unknown): string | undefined {
  const color = candidate(value);
  if (color === undefined) {
    return undefined;
  }
  return HEX_COLOR.test(color) || FUNCTIONAL_COLOR.test(color) || NAMED_COLOR.test(color)
    ? color
    : undefined;
}

function comparableFamily(value: string): string {
  return value.replace(/["'\s]/g, '').toLowerCase();
}

export function safeFontFamily(value: unknown): string | undefined {
  const family = candidate(value);
  if (family === undefined) {
    return undefined;
  }
  const wanted = comparableFamily(family);
  return FONT_FAMILIES.find((option) => comparableFamily(option.value) === wanted)?.value;
}

export function safeFontSize(value: unknown): string | undefined {
  const size = candidate(value);
  const match = size === undefined ? null : PIXEL_SIZE.exec(size);
  if (match === null) {
    return undefined;
  }
  const pixels = Number(match[1]);
  return pixels >= FONT_SIZE_MIN_PX && pixels <= FONT_SIZE_MAX_PX ? `${pixels}px` : undefined;
}

export function fontSizePixels(size: string): number {
  return Number.parseInt(size, 10);
}

export function fontSizeFromInput(text: string): string | undefined {
  const match = TYPED_SIZE.exec(text.trim());
  if (match === null) {
    return undefined;
  }
  const typed = Math.round(Number(match[1].replace(',', '.')));
  const pixels = Math.min(FONT_SIZE_MAX_PX, Math.max(FONT_SIZE_MIN_PX, typed));
  return `${pixels}px`;
}

export function stepFontSize(size: string, direction: 1 | -1): string {
  const pixels = fontSizePixels(size);
  const stops = FONT_SIZES.map(fontSizePixels);
  const next =
    direction === 1
      ? stops.find((stop) => stop > pixels)
      : [...stops].reverse().find((stop) => stop < pixels);
  return `${next ?? pixels}px`;
}

export function safeLineHeight(value: unknown): string | undefined {
  const height = candidate(value);
  return LINE_HEIGHTS.find((option) => option.value === height)?.value;
}

export type StyleSanitizer = (value: unknown) => string | undefined;

export interface StyledElement {
  getAttribute(name: string): string | null;
}

export interface StyleAttributeSpec {
  default: null;
  parseHTML: (element: StyledElement) => string | null;
  renderHTML: (attributes: Record<string, unknown>) => Record<string, string>;
}

export function styleAttribute(
  name: string,
  property: string,
  sanitize: StyleSanitizer,
): StyleAttributeSpec {
  return {
    default: null,
    parseHTML: (element) =>
      sanitize(styleDeclaration(element.getAttribute('style'), property)) ?? null,
    renderHTML: (attributes): Record<string, string> => {
      const value = sanitize(attributes[name]);
      return value === undefined ? {} : { style: `${property}: ${value}` };
    },
  };
}

export function highlightColorAttribute(): StyleAttributeSpec {
  return {
    default: null,
    parseHTML: (element) =>
      safeColor(element.getAttribute('data-color')) ??
      safeColor(styleDeclaration(element.getAttribute('style'), 'background-color')) ??
      null,
    renderHTML: (attributes): Record<string, string> => {
      const color = safeColor(attributes.color);
      return color === undefined
        ? {}
        : { 'data-color': color, style: `background-color: ${color}; color: inherit` };
    },
  };
}
