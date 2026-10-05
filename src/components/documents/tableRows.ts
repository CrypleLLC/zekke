import { Extension } from '@tiptap/core';
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { rowHeightAfterDrag, safeRowHeight } from '@/lib/document-tables';
import { safeColor, styleDeclaration } from '@/lib/document-styles';

const ROW_EDGE_PX = 5;
const RESIZE_CURSOR_CLASS = 'zekke-row-resize-cursor';
const ACTIVE_ROW_CLASS = 'zekke-row-resize-target';

export const SizedTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null,
        parseHTML: (element) =>
          safeRowHeight(styleDeclaration(element.getAttribute('style'), 'height')) ?? null,
        renderHTML: (attributes) => {
          const height = safeRowHeight(attributes.height);
          return height === undefined ? {} : { style: `height: ${height}px` };
        },
      },
    };
  },
});

function cellBackgroundAttribute() {
  return {
    default: null,
    parseHTML: (element: HTMLElement) =>
      safeColor(styleDeclaration(element.getAttribute('style'), 'background-color')) ?? null,
    renderHTML: (attributes: Record<string, unknown>) => {
      const color = safeColor(attributes.backgroundColor);
      return color === undefined ? {} : { style: `background-color: ${color}` };
    },
  };
}

export const ColouredTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), backgroundColor: cellBackgroundAttribute() };
  },
});

export const ColouredTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), backgroundColor: cellBackgroundAttribute() };
  },
});

interface RowUnderPointer {
  pos: number;
  element: HTMLTableRowElement;
}

function rowEdgeAt(view: EditorView, event: MouseEvent): RowUnderPointer | undefined {
  const target = event.target;
  if (!(target instanceof Element)) {
    return undefined;
  }
  const cell = target.closest('td, th');
  if (cell === null || !view.dom.contains(cell)) {
    return undefined;
  }
  const bottom = cell.getBoundingClientRect().bottom;
  if (event.clientY < bottom - ROW_EDGE_PX || event.clientY > bottom + 1) {
    return undefined;
  }
  const element = cell.parentElement;
  if (!(element instanceof HTMLTableRowElement)) {
    return undefined;
  }
  const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0));
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.spec.tableRole === 'row') {
      return { pos: $pos.before(depth), element };
    }
  }
  return undefined;
}

function pageScale(view: EditorView): number {
  return Number.parseFloat(window.getComputedStyle(view.dom).getPropertyValue('--page-scale')) || 1;
}

interface RowDrag {
  pos: number;
  startY: number;
  startHeight: number;
  scale: number;
  height: number;
}

interface RowResizeState {
  hover?: number;
  drag?: RowDrag;
}

type RowResizeMeta = { hover?: number | null; drag?: RowDrag | null };

const rowResizeKey = new PluginKey<RowResizeState>('zekke-row-resizing');

function setRowResize(view: EditorView, meta: RowResizeMeta) {
  view.dispatch(view.state.tr.setMeta(rowResizeKey, meta).setMeta('addToHistory', false));
}

function rowResizingPlugin(): Plugin<RowResizeState> {
  let editor: EditorView | undefined;

  const onPointerMove = (event: MouseEvent) => {
    const view = editor;
    const drag = view === undefined ? undefined : rowResizeKey.getState(view.state)?.drag;
    if (view === undefined || drag === undefined) {
      return;
    }
    const height = rowHeightAfterDrag(drag.startHeight, event.clientY - drag.startY, drag.scale);
    if (height !== drag.height) {
      setRowResize(view, { drag: { ...drag, height } });
    }
  };

  const onPointerUp = () => {
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseup', onPointerUp);
    const view = editor;
    if (view === undefined || view.isDestroyed) {
      return;
    }
    const drag = rowResizeKey.getState(view.state)?.drag;
    const row = drag === undefined ? null : view.state.doc.nodeAt(drag.pos);
    const tr = view.state.tr.setMeta(rowResizeKey, { drag: null, hover: null });
    if (drag !== undefined && row?.type.spec.tableRole === 'row' && drag.height !== drag.startHeight) {
      tr.setNodeMarkup(drag.pos, undefined, { ...row.attrs, height: drag.height });
    } else {
      tr.setMeta('addToHistory', false);
    }
    view.dispatch(tr);
  };

  return new Plugin<RowResizeState>({
    key: rowResizeKey,
    state: {
      init: () => ({}),
      apply(tr, value) {
        const meta = tr.getMeta(rowResizeKey) as RowResizeMeta | undefined;
        let next = value;
        if (tr.docChanged) {
          next = {
            hover: next.hover === undefined ? undefined : tr.mapping.map(next.hover),
            drag: next.drag === undefined ? undefined : { ...next.drag, pos: tr.mapping.map(next.drag.pos) },
          };
        }
        if (meta === undefined) {
          return next;
        }
        return {
          hover: meta.hover === undefined ? next.hover : (meta.hover ?? undefined),
          drag: meta.drag === undefined ? next.drag : (meta.drag ?? undefined),
        };
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
      attributes: (state): Record<string, string> => {
        const resize = rowResizeKey.getState(state);
        return resize?.hover !== undefined || resize?.drag !== undefined
          ? { class: RESIZE_CURSOR_CLASS }
          : {};
      },
      decorations: (state) => {
        const resize = rowResizeKey.getState(state);
        const pos = resize?.drag?.pos ?? resize?.hover;
        const row = pos === undefined ? null : state.doc.nodeAt(pos);
        if (pos === undefined || row?.type.spec.tableRole !== 'row') {
          return DecorationSet.empty;
        }
        const attrs: Record<string, string> = { class: ACTIVE_ROW_CLASS };
        if (resize?.drag !== undefined) {
          attrs.style = `height: ${resize.drag.height}px`;
        }
        return DecorationSet.create(state.doc, [Decoration.node(pos, pos + row.nodeSize, attrs)]);
      },
      handleDOMEvents: {
        mousemove: (view, event) => {
          const resize = rowResizeKey.getState(view.state);
          if (resize?.drag !== undefined || !view.editable) {
            return false;
          }
          const edge = rowEdgeAt(view, event)?.pos;
          if (edge !== resize?.hover) {
            setRowResize(view, { hover: edge ?? null });
          }
          return false;
        },
        mouseleave: (view) => {
          const resize = rowResizeKey.getState(view.state);
          if (resize?.drag === undefined && resize?.hover !== undefined) {
            setRowResize(view, { hover: null });
          }
          return false;
        },
        mousedown: (view, event) => {
          if (event.button !== 0 || !view.editable) {
            return false;
          }
          const edge = rowEdgeAt(view, event);
          if (edge === undefined) {
            return false;
          }
          event.preventDefault();
          const startHeight = edge.element.offsetHeight;
          setRowResize(view, {
            hover: edge.pos,
            drag: {
              pos: edge.pos,
              startY: event.clientY,
              startHeight,
              scale: pageScale(view),
              height: startHeight,
            },
          });
          window.addEventListener('mousemove', onPointerMove);
          window.addEventListener('mouseup', onPointerUp);
          return true;
        },
      },
    },
  });
}

export const RowResizing = Extension.create({
  name: 'zekkeRowResizing',

  addProseMirrorPlugins() {
    return [rowResizingPlugin()];
  },
});
