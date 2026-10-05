import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getAttributesFromExtensions, resolveExtensions } from '@tiptap/core';
import { FONT_FAMILIES } from '@/lib/document-styles';
import { documentExtensions } from './extensions';

const INJECTED = 'red; background-image: url(https://tracker.example/opened)';

function attribute(type: string, name: string) {
  const found = getAttributesFromExtensions(resolveExtensions(documentExtensions(new Y.Doc()))).find(
    (entry) => entry.type === type && entry.name === name,
  );
  if (found === undefined) {
    throw new Error(`the editor has no ${name} attribute on ${type}`);
  }
  return found.attribute;
}

describe('the document editor extensions', () => {
  it.each([
    ['textStyle', 'color'],
    ['textStyle', 'fontFamily'],
    ['textStyle', 'fontSize'],
    ['paragraph', 'lineHeight'],
    ['heading', 'lineHeight'],
    ['highlight', 'color'],
  ])('%s.%s renders nothing for an injected value', (type, name) => {
    expect(attribute(type, name).renderHTML?.({ [name]: INJECTED })).toEqual({});
  });

  it('parses an injected highlight data-color as nothing', () => {
    const pasted = { getAttribute: (name: string) => (name === 'data-color' ? INJECTED : null) };
    expect(attribute('highlight', 'color').parseHTML?.(pasted as unknown as HTMLElement)).toBeNull();
  });

  it('still renders what the toolbar sets', () => {
    expect(attribute('textStyle', 'color').renderHTML?.({ color: '#b91c1c' })).toEqual({
      style: 'color: #b91c1c',
    });
    expect(attribute('highlight', 'color').renderHTML?.({ color: '#fef08a' })).toEqual({
      'data-color': '#fef08a',
      style: 'background-color: #fef08a; color: inherit',
    });
  });
});

describe('the document fonts', () => {
  it('loads a next/font variable for every --font-doc-* family the toolbar offers', () => {
    const loader = readFileSync(new URL('./fonts.ts', import.meta.url), 'utf8');
    const wanted = FONT_FAMILIES.flatMap((font) => font.value.match(/--font-doc-[a-z-]+/g) ?? []);
    expect(wanted.length).toBeGreaterThan(0);
    for (const variable of wanted) {
      expect(loader).toContain(`variable: '${variable}'`);
    }
    expect(loader.match(/variable: '--font-doc-/g)?.length).toBe(wanted.length);
  });
});

describe('table row heights', () => {
  it('stores a pasted height in pixels and renders it back as the row style', () => {
    const height = attribute('tableRow', 'height');
    const pasted = { getAttribute: (name: string) => (name === 'style' ? 'height: 48px' : null) };
    expect(height.parseHTML?.(pasted as unknown as HTMLElement)).toBe(48);
    expect(height.renderHTML?.({ height: 48 })).toEqual({ style: 'height: 48px' });
  });

  it('keeps an injected or out-of-range height out of the document and out of the style', () => {
    const height = attribute('tableRow', 'height');
    const injected = {
      getAttribute: (name: string) => (name === 'style' ? `height: 48px; background-image: url(x)` : null),
    };
    expect(height.parseHTML?.(injected as unknown as HTMLElement)).toBe(48);
    const hostile = { getAttribute: (name: string) => (name === 'style' ? 'height: url(x)' : null) };
    expect(height.parseHTML?.(hostile as unknown as HTMLElement)).toBeNull();
    expect(height.renderHTML?.({ height: INJECTED })).toEqual({});
    expect(height.renderHTML?.({ height: 5 })).toEqual({});
  });
});

describe('cell background colours', () => {
  it.each(['tableCell', 'tableHeader'])('%s stores a pasted fill and renders it back', (type) => {
    const fill = attribute(type, 'backgroundColor');
    const pasted = { getAttribute: (name: string) => (name === 'style' ? 'background-color: #fef08a' : null) };
    expect(fill.parseHTML?.(pasted as unknown as HTMLElement)).toBe('#fef08a');
    expect(fill.renderHTML?.({ backgroundColor: '#fef08a' })).toEqual({ style: 'background-color: #fef08a' });
  });

  it.each(['tableCell', 'tableHeader'])('%s keeps an injected fill out of the document and the style', (type) => {
    const fill = attribute(type, 'backgroundColor');
    const hostile = {
      getAttribute: (name: string) => (name === 'style' ? 'background-color: url(https://tracker.example/x)' : null),
    };
    expect(fill.parseHTML?.(hostile as unknown as HTMLElement)).toBeNull();
    expect(fill.renderHTML?.({ backgroundColor: INJECTED })).toEqual({});
    expect(fill.renderHTML?.({ backgroundColor: null })).toEqual({});
  });
});
