import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCUMENT_FONT,
  FONT_FAMILIES,
  FONT_GROUPS,
  LEGACY_DOCUMENT_FONT,
  documentBaseFont,
  FONT_SIZE_MAX_PX,
  FONT_SIZE_MIN_PX,
  FONT_SIZES,
  HIGHLIGHT_COLORS,
  LINE_HEIGHTS,
  TEXT_COLORS,
  TEXT_COLOR_COLUMNS,
  fontSizeFromInput,
  highlightColorAttribute,
  pickerColor,
  safeColor,
  safeFontFamily,
  safeFontSize,
  safeLineHeight,
  styleAttribute,
  stepFontSize,
  styleDeclaration,
  type StyledElement,
} from './index';

const TRACKER = 'https://tracker.example/opened';

function pasted(attributes: Record<string, string>): StyledElement {
  return { getAttribute: (name) => attributes[name] ?? null };
}

const INJECTIONS = [
  `red; background-image: url(${TRACKER})`,
  `url(${TRACKER})`,
  `red url(${TRACKER})`,
  'var(--anything)',
  'expression(alert(1))',
  'rgb(1, 2, 3); background: red',
  String.raw`\75rl(x)`,
  '"red"; x: y',
  'red /* comment */',
  '',
  'x'.repeat(65),
];

describe('styleDeclaration', () => {
  it('reads one declaration, and the last one when repeated', () => {
    expect(styleDeclaration('color: red; COLOR : blue', 'color')).toBe('blue');
    expect(styleDeclaration('font-size: 16px; background-image: url(x)', 'font-size')).toBe('16px');
  });

  it('finds nothing in an absent or unrelated style', () => {
    expect(styleDeclaration(null, 'color')).toBeUndefined();
    expect(styleDeclaration('font-size: 16px', 'color')).toBeUndefined();
    expect(styleDeclaration('color', 'color')).toBeUndefined();
  });
});

describe('safeColor', () => {
  it('accepts the colour forms a paste or the toolbar produces', () => {
    for (const color of ['#fef08a', '#FFF', '#0f172a80', 'rgb(1, 2, 3)', 'rgba(1 2 3 / 50%)', 'hsl(120deg 50% 50%)', 'red']) {
      expect(safeColor(color)).toBe(color);
    }
  });

  it('refuses anything that could carry a second declaration or load a resource', () => {
    for (const injection of INJECTIONS) {
      expect(safeColor(injection)).toBeUndefined();
    }
    expect(safeColor(42)).toBeUndefined();
    expect(safeColor(null)).toBeUndefined();
  });
});

describe('the list-bound values', () => {
  it('maps a font family written with other quotes or spacing to the toolbar value', () => {
    expect(safeFontFamily(`Georgia,'Times New Roman',serif`)).toBe('Georgia, "Times New Roman", serif');
    expect(safeFontFamily('var(--font-mono)')).toBe('var(--font-mono)');
  });

  it('drops any family, size or line height the toolbar cannot produce', () => {
    expect(safeFontFamily('Comic Sans MS')).toBeUndefined();
    expect(safeFontSize('11pt')).toBeUndefined();
    expect(safeLineHeight('1.15')).toBeUndefined();
    for (const injection of INJECTIONS) {
      expect(safeFontFamily(injection)).toBeUndefined();
      expect(safeFontSize(injection)).toBeUndefined();
      expect(safeLineHeight(injection)).toBeUndefined();
    }
  });

  it('accepts every value the toolbar offers', () => {
    for (const option of FONT_FAMILIES) {
      expect(safeFontFamily(option.value)).toBe(option.value);
    }
    for (const size of FONT_SIZES) {
      expect(safeFontSize(size)).toBe(size);
    }
    for (const option of LINE_HEIGHTS) {
      expect(safeLineHeight(option.value)).toBe(option.value);
    }
    for (const color of [...HIGHLIGHT_COLORS, ...TEXT_COLORS]) {
      expect(safeColor(color)).toBe(color);
    }
  });
});

describe('the font list', () => {
  it('puts every family in a group the toolbar draws, under a unique label and value', () => {
    for (const font of FONT_FAMILIES) {
      expect(FONT_GROUPS).toContain(font.group);
    }
    expect(new Set(FONT_FAMILIES.map((font) => font.label)).size).toBe(FONT_FAMILIES.length);
    expect(new Set(FONT_FAMILIES.map((font) => font.value)).size).toBe(FONT_FAMILIES.length);
  });

  it('opens with Arial, Times New Roman and Courier New, Arial first', () => {
    expect(FONT_GROUPS[0]).toBe('Classic');
    expect(FONT_FAMILIES.slice(0, 3).map((font) => [font.label, font.group])).toEqual([
      ['Arial', 'Classic'],
      ['Times New Roman', 'Classic'],
      ['Courier New', 'Classic'],
    ]);
  });

  it('starts a new document in Arial and keeps the older ones in Inter', () => {
    expect(DEFAULT_DOCUMENT_FONT).toBe(FONT_FAMILIES[0].value);
    expect(documentBaseFont(DEFAULT_DOCUMENT_FONT)).toBe(DEFAULT_DOCUMENT_FONT);
    expect(documentBaseFont(undefined)).toBe(LEGACY_DOCUMENT_FONT);
    expect(documentBaseFont(`Arial; background-image: url(${TRACKER})`)).toBe(LEGACY_DOCUMENT_FONT);
    expect(safeFontFamily(LEGACY_DOCUMENT_FONT)).toBe(LEGACY_DOCUMENT_FONT);
  });

  it('keeps the three values documents were written with before the Google fonts', () => {
    for (const legacy of ['var(--font-sans)', 'Georgia, "Times New Roman", serif', 'var(--font-mono)']) {
      expect(safeFontFamily(legacy)).toBe(legacy);
    }
  });
});

describe('font sizes', () => {
  it('offers presets from the minimum to the maximum, in ascending order', () => {
    const pixels = FONT_SIZES.map((size) => Number.parseInt(size, 10));
    expect(pixels[0]).toBe(FONT_SIZE_MIN_PX);
    expect(pixels[pixels.length - 1]).toBe(FONT_SIZE_MAX_PX);
    expect([...pixels].sort((a, b) => a - b)).toEqual(pixels);
  });

  it('accepts any whole pixel size in range, not only the presets', () => {
    expect(safeFontSize('8px')).toBe('8px');
    expect(safeFontSize('13px')).toBe('13px');
    expect(safeFontSize('96px')).toBe('96px');
  });

  it('refuses sizes out of range, in other units, fractional or padded', () => {
    for (const size of ['7px', '97px', '0px', '100px', '13.5px', '014px', '14', '14em', '14 px', '-14px']) {
      expect(safeFontSize(size)).toBeUndefined();
    }
  });

  it('reads what a person types, rounding and clamping to the range', () => {
    expect(fontSizeFromInput('14')).toBe('14px');
    expect(fontSizeFromInput(' 14px ')).toBe('14px');
    expect(fontSizeFromInput('13.6')).toBe('14px');
    expect(fontSizeFromInput('10,4')).toBe('10px');
    expect(fontSizeFromInput('3')).toBe('8px');
    expect(fontSizeFromInput('400')).toBe('96px');
  });

  it('ignores typing that is not a size', () => {
    for (const text of ['', 'abc', '14pt', '1e3', '-12', '12px; color: red']) {
      expect(fontSizeFromInput(text)).toBeUndefined();
    }
  });

  it('steps to the neighbouring preset, from a preset or from between two', () => {
    expect(stepFontSize('16px', 1)).toBe('18px');
    expect(stepFontSize('16px', -1)).toBe('14px');
    expect(stepFontSize('13px', 1)).toBe('14px');
    expect(stepFontSize('13px', -1)).toBe('12px');
    expect(stepFontSize('96px', 1)).toBe('96px');
    expect(stepFontSize('8px', -1)).toBe('8px');
  });
});

describe('the colour menus', () => {
  it('lays the text colours out in full rows of distinct, safe colours', () => {
    expect(TEXT_COLORS.length % TEXT_COLOR_COLUMNS).toBe(0);
    expect(new Set(TEXT_COLORS).size).toBe(TEXT_COLORS.length);
    expect(new Set(HIGHLIGHT_COLORS).size).toBe(HIGHLIGHT_COLORS.length);
    for (const color of [...TEXT_COLORS, ...HIGHLIGHT_COLORS]) {
      expect(safeColor(color)).toBe(color);
    }
  });

  it('keeps the highlights the first palette offered, so older documents still match a swatch', () => {
    for (const color of ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca']) {
      expect(HIGHLIGHT_COLORS).toContain(color);
    }
  });

  it('gives the native colour input the only format it takes', () => {
    expect(pickerColor('#B91C1C')).toBe('#b91c1c');
    expect(pickerColor('#abc')).toBe('#aabbcc');
    expect(pickerColor('rgb(1, 2, 3)')).toBe('#000000');
    expect(pickerColor('#0f172a80')).toBe('#000000');
    expect(pickerColor(undefined, '#0f172a')).toBe('#0f172a');
  });
});

describe('styleAttribute', () => {
  const fontSize = styleAttribute('fontSize', 'font-size', safeFontSize);

  it('keeps only its own declaration from a pasted style', () => {
    expect(fontSize.parseHTML(pasted({ style: `font-size: 16px; background-image: url(${TRACKER})` }))).toBe('16px');
    expect(fontSize.renderHTML({ fontSize: '16px' })).toEqual({ style: 'font-size: 16px' });
  });

  it('stores nothing for a value it refuses', () => {
    expect(fontSize.parseHTML(pasted({ style: 'font-size: 11pt' }))).toBeNull();
  });

  it('renders nothing for a refused value already in the document', () => {
    expect(fontSize.renderHTML({ fontSize: `16px; background-image: url(${TRACKER})` })).toEqual({});
  });
});

describe('highlightColorAttribute', () => {
  const highlight = highlightColorAttribute();

  it('refuses an injected data-color and falls back to the style', () => {
    const element = pasted({
      'data-color': `red; background-image: url(${TRACKER})`,
      style: 'background-color: #fef08a',
    });
    expect(highlight.parseHTML(element)).toBe('#fef08a');
  });

  it('stores nothing when neither source is a colour', () => {
    expect(highlight.parseHTML(pasted({ 'data-color': `url(${TRACKER})` }))).toBeNull();
  });

  it('renders a valid colour the way TipTap does, and nothing for an injected one', () => {
    expect(highlight.renderHTML({ color: '#bbf7d0' })).toEqual({
      'data-color': '#bbf7d0',
      style: 'background-color: #bbf7d0; color: inherit',
    });
    expect(highlight.renderHTML({ color: `red; background-image: url(${TRACKER})` })).toEqual({});
  });
});
