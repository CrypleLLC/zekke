import type { Node as PMNode } from '@tiptap/pm/model';

export interface OutlineEntry {
  pos: number;
  level: number;
  text: string;
}

export interface OutlineNode extends OutlineEntry {
  children: OutlineNode[];
}

export function readOutline(doc: PMNode): OutlineEntry[] {
  const entries: OutlineEntry[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      entries.push({ pos, level: node.attrs.level as number, text: node.textContent });
    }
    return false;
  });

  return entries;
}

export function outlineTree(entries: readonly OutlineEntry[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  for (const entry of entries) {
    const node: OutlineNode = { ...entry, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }

    stack.push(node);
  }

  return roots;
}

export interface HeadingOffset {
  pos: number;
  top: number;
}

export interface ScrollWindow {
  readingLine: number;
  viewportBottom: number;
  atBottom: boolean;
}

export function headingAtScroll(
  headings: readonly HeadingOffset[],
  scroll: ScrollWindow,
): number | undefined {
  if (headings.length === 0) {
    return undefined;
  }

  if (scroll.atBottom) {
    const visible = headings.filter((heading) => heading.top < scroll.viewportBottom);
    if (visible.length > 0) {
      return visible[visible.length - 1].pos;
    }
  }

  let active: number | undefined;
  for (const heading of headings) {
    if (heading.top > scroll.readingLine) {
      break;
    }
    active = heading.pos;
  }

  if (active === undefined && headings[0].top < scroll.viewportBottom) {
    return headings[0].pos;
  }

  return active;
}
