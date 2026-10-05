import { describe, expect, it } from 'vitest';
import { headingAtScroll, outlineTree, type HeadingOffset, type OutlineEntry } from './outline';

function heading(pos: number, level: number, text = ''): OutlineEntry {
  return { pos, level, text };
}

describe('outline tree', () => {
  it('nests a well-formed hierarchy', () => {
    const roots = outlineTree([heading(0, 1), heading(10, 2), heading(20, 3), heading(30, 2)]);

    expect(roots).toHaveLength(1);
    expect(roots[0].children.map((child) => child.pos)).toEqual([10, 30]);
    expect(roots[0].children[0].children.map((child) => child.pos)).toEqual([20]);
  });

  it('treats a document that starts at h2 as having h2 roots', () => {
    const roots = outlineTree([heading(0, 2), heading(10, 2)]);

    expect(roots.map((root) => root.pos)).toEqual([0, 10]);
    expect(roots.every((root) => root.children.length === 0)).toBe(true);
  });

  it('nests across a skipped level rather than dropping the heading', () => {
    const roots = outlineTree([heading(0, 1), heading(10, 3)]);

    expect(roots).toHaveLength(1);
    expect(roots[0].children.map((child) => child.pos)).toEqual([10]);
  });

  it('reparents when a level climbs back above its predecessor', () => {
    const roots = outlineTree([heading(0, 3), heading(10, 1), heading(20, 2)]);

    expect(roots.map((root) => root.pos)).toEqual([0, 10]);
    expect(roots[1].children.map((child) => child.pos)).toEqual([20]);
  });

  it('keeps an untitled heading, because one is created before it is named', () => {
    const roots = outlineTree([heading(0, 1, '')]);

    expect(roots).toHaveLength(1);
    expect(roots[0].text).toBe('');
  });

  it('returns nothing for a document without headings', () => {
    expect(outlineTree([])).toEqual([]);
  });
});

describe('the heading at the scroll position', () => {
  const headings: HeadingOffset[] = [
    { pos: 0, top: -900 },
    { pos: 10, top: -200 },
    { pos: 30, top: 400 },
    { pos: 50, top: 1500 },
  ];
  const middle = { readingLine: 150, viewportBottom: 1000, atBottom: false };

  it('is the last heading that has scrolled past the reading line', () => {
    expect(headingAtScroll(headings, middle)).toBe(10);
  });

  it('switches as soon as the next heading reaches the reading line', () => {
    const reached = headings.map((heading) => (heading.pos === 30 ? { ...heading, top: 150 } : heading));
    expect(headingAtScroll(reached, middle)).toBe(30);
  });

  it('is the first heading while it is on screen and nothing has passed the line yet', () => {
    expect(
      headingAtScroll([{ pos: 4, top: 300 }, { pos: 20, top: 700 }], middle),
    ).toBe(4);
  });

  it('is nothing while the first heading is still below the screen', () => {
    expect(headingAtScroll([{ pos: 4, top: 1200 }], middle)).toBeUndefined();
  });

  it('is the last heading on screen once the page cannot scroll further', () => {
    const bottom = { readingLine: 150, viewportBottom: 1000, atBottom: true };
    expect(headingAtScroll(headings, bottom)).toBe(30);
    expect(
      headingAtScroll([...headings.slice(0, 3), { pos: 50, top: 900 }], bottom),
    ).toBe(50);
  });

  it('is nothing when there are no headings', () => {
    expect(headingAtScroll([], middle)).toBeUndefined();
  });
});
