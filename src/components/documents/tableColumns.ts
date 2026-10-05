import { Extension } from '@tiptap/core';
import { TableView } from '@tiptap/extension-table';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { dragColumnBorder, fitColumnWidths } from '@/lib/document-tables';
import { columnWidths, withColumnWidths, type TableAt } from './tableWidths';

const BORDER_EDGE_PX = 5;
const RESIZE_CURSOR_CLASS = 'zekke-column-resize-cursor';
const ACTIVE_COLUMN_CLASS = 'zekke-column-resize-target';

export class FittedTableView extends TableView {
  constructor(node: PMNode, cellMinWidth: number, view: EditorView, attributes?: Record<string, unknown>) {
    super(node, cellMinWidth, view, attributes);
    this.fit();
  }

  update(node: PMNode): boolean {
    const updated = super.update(node);
    if (updated) {
      this.fit();
    }
    return updated;
  }

  private fit() {
    const total = Number.parseFloat(this.table.style.width);
    if (!this.table.style.width.endsWith('px') || !(total > 0)) {
      this.table.style.maxWidth = '';
      return;
    }
    for (const column of Array.from(this.colgroup.children)) {
      if (column instanceof HTMLElement && column.style.width.endsWith('px')) {
        column.style.width = `${(Number.parseFloat(column.style.width) / total) * 100}%`;
      }
    }
    this.table.style.width = `${total}px`;
    this.table.style.maxWidth = '100%';
  }
}

export function previewColumnWidths(wrapper: Element, widths: readonly number[]) {
  const table = wrapper.querySelector('table');
  const columns = wrapper.querySelector('colgroup')?.children;
  if (table === null || columns === undefined) {
    return;
  }
  const total = widths.reduce((sum, width) => sum + width, 0);
  widths.forEach((width, index) => {
    const column = columns[index];
    if (column instanceof HTMLElement) {
      column.style.width = `${(width / total) * 100}%`;
    }
  });
  table.style.width = `${total}px`;
  table.style.minWidth = '';
  table.style.maxWidth = '100%';
}

interface ColumnBorder {
  table: TableAt;
  column: number;
  wrapper: HTMLElement;
}

function borderAt(view: EditorView, event: MouseEvent): ColumnBorder | undefined {
  const target = event.target;
  if (!(target instanceof Element)) {
    return undefined;
  }
  const cell = target.closest('td, th');
  const wrapper = cell?.closest('.tableWrapper');
  if (cell === null || cell === undefined || !(wrapper instanceof HTMLElement) || !view.dom.contains(cell)) {
    return undefined;
  }
  const right = cell.getBoundingClientRect().right;
  if (event.clientX < right - BORDER_EDGE_PX || event.clientX > right + 1) {
    return undefined;
  }
  const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0));
  let cellPos: number | undefined;
  let table: TableAt | undefined;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const role = $pos.node(depth).type.spec.tableRole;
    if (cellPos === undefined && (role === 'cell' || role === 'header_cell')) {
      cellPos = $pos.before(depth);
    }
    if (role === 'table') {
      table = { pos: $pos.before(depth), node: $pos.node(depth) };
      break;
    }
  }
  if (cellPos === undefined || table === undefined) {
    return undefined;
  }
  const column = TableMap.get(table.node).findCell(cellPos - table.pos - 1).right - 1;
  return { table, column, wrapper };
}

function pageScale(view: EditorView): number {
  return Number.parseFloat(window.getComputedStyle(view.dom).getPropertyValue('--page-scale')) || 1;
}

interface Hover {
  table: number;
  column: number;
}

interface Drag {
  table: TableAt;
  column: number;
  wrapper: HTMLElement;
  startX: number;
  scale: number;
  available: number;
  start: number[];
  widths: number[];
}

type HoverMeta = { hover: Hover | null };

const columnResizeKey = new PluginKey<Hover | null>('zekke-column-resizing');

function sameHover(left: Hover | null | undefined, right: Hover | null | undefined) {
  return left?.table === right?.table && left?.column === right?.column;
}

function columnResizingPlugin(): Plugin<Hover | null> {
  let editor: EditorView | undefined;
  let drag: Drag | undefined;

  const setHover = (view: EditorView, hover: Hover | null) => {
    if (!sameHover(columnResizeKey.getState(view.state), hover)) {
      view.dispatch(
        view.state.tr.setMeta(columnResizeKey, { hover } satisfies HoverMeta).setMeta('addToHistory', false),
      );
    }
  };

  const onPointerMove = (event: MouseEvent) => {
    if (drag === undefined) {
      return;
    }
    drag.widths = dragColumnBorder(
      drag.start,
      drag.column,
      (event.clientX - drag.startX) / drag.scale,
      drag.available,
    );
    previewColumnWidths(drag.wrapper, drag.widths);
  };

  const onPointerUp = () => {
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseup', onPointerUp);
    const view = editor;
    const finished = drag;
    drag = undefined;
    if (view === undefined || finished === undefined || view.isDestroyed) {
      return;
    }
    const tr = view.state.tr.setMeta(columnResizeKey, { hover: null } satisfies HoverMeta);
    const node = view.state.doc.nodeAt(finished.table.pos);
    if (node?.type.spec.tableRole === 'table') {
      withColumnWidths(tr, { pos: finished.table.pos, node }, finished.widths);
    }
    view.dispatch(tr);
  };

  return new Plugin<Hover | null>({
    key: columnResizeKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const meta = tr.getMeta(columnResizeKey) as HoverMeta | undefined;
        if (meta !== undefined) {
          return meta.hover;
        }
        if (value !== null && tr.docChanged) {
          return { ...value, table: tr.mapping.map(value.table) };
        }
        return value;
      },
    },
    view: (view) => {
      editor = view;
      return {
        destroy: () => {
          window.removeEventListener('mousemove', onPointerMove);
          window.removeEventListener('mouseup', onPointerUp);
          editor = undefined;
        },
      };
    },
    props: {
      attributes: (state): Record<string, string> =>
        (columnResizeKey.getState(state) ?? null) === null ? {} : { class: RESIZE_CURSOR_CLASS },
      decorations: (state) => {
        const hover = columnResizeKey.getState(state) ?? null;
        const table = hover === null ? null : state.doc.nodeAt(hover.table);
        if (hover === null || table === null || table.type.spec.tableRole !== 'table') {
          return DecorationSet.empty;
        }
        const map = TableMap.get(table);
        const decorations: Decoration[] = [];
        const seen = new Set<number>();
        for (let row = 0; row < map.height; row += 1) {
          const offset = map.map[row * map.width + hover.column];
          if (seen.has(offset) || map.findCell(offset).right - 1 !== hover.column) {
            continue;
          }
          seen.add(offset);
          const cell = table.nodeAt(offset);
          if (cell !== null) {
            const from = hover.table + 1 + offset;
            decorations.push(Decoration.node(from, from + cell.nodeSize, { class: ACTIVE_COLUMN_CLASS }));
          }
        }
        return DecorationSet.create(state.doc, decorations);
      },
      handleDOMEvents: {
        mousemove: (view, event) => {
          if (drag !== undefined || !view.editable) {
            return false;
          }
          const border = borderAt(view, event);
          setHover(view, border === undefined ? null : { table: border.table.pos, column: border.column });
          return false;
        },
        mouseleave: (view) => {
          if (drag === undefined) {
            setHover(view, null);
          }
          return false;
        },
        mousedown: (view, event) => {
          if (event.button !== 0 || !view.editable) {
            return false;
          }
          const border = borderAt(view, event);
          if (border === undefined) {
            return false;
          }
          event.preventDefault();
          const available = view.dom.clientWidth;
          const start = fitColumnWidths(columnWidths(view, border.table), available);
          drag = {
            ...border,
            startX: event.clientX,
            scale: pageScale(view),
            available,
            start,
            widths: start,
          };
          setHover(view, { table: border.table.pos, column: border.column });
          previewColumnWidths(border.wrapper, start);
          window.addEventListener('mousemove', onPointerMove);
          window.addEventListener('mouseup', onPointerUp);
          return true;
        },
      },
    },
  });
}

export const ColumnResizing = Extension.create({
  name: 'zekkeColumnResizing',

  addProseMirrorPlugins() {
    return [columnResizingPlugin()];
  },
});
