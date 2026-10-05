import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { tableAt } from './tableWidths';

const HANDLE_CLASS = 'zekke-table-handle';
const HIDE_DELAY_MS = 300;

export function selectTable(tr: Transaction): boolean {
  const table = tableAt(tr);
  if (table === undefined) {
    return false;
  }
  tr.setSelection(NodeSelection.create(tr.doc, table.pos));
  return true;
}

function tablePosOf(view: EditorView, wrapper: Element): number | undefined {
  const $pos = view.state.doc.resolve(view.posAtDOM(wrapper, 0));
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.spec.tableRole === 'table') {
      return $pos.before(depth);
    }
  }
  const after = $pos.nodeAfter;
  return after?.type.spec.tableRole === 'table' ? $pos.pos : undefined;
}

class TableHandleView {
  private readonly view: EditorView;
  private readonly handle: HTMLButtonElement;
  private tablePos?: number;
  private wrapper?: HTMLElement;
  private hideTimer = 0;

  constructor(view: EditorView) {
    this.view = view;
    this.handle = document.createElement('button');
    this.handle.type = 'button';
    this.handle.className = `${HANDLE_CLASS} zekke-no-print`;
    this.handle.draggable = true;
    this.handle.title = 'Select or drag the table';
    this.handle.setAttribute('aria-label', 'Select table');
    this.handle.innerHTML =
      '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="4" cy="3" r="1"/><circle cx="8" cy="3" r="1"/><circle cx="4" cy="6" r="1"/><circle cx="8" cy="6" r="1"/><circle cx="4" cy="9" r="1"/><circle cx="8" cy="9" r="1"/></svg>';
    this.handle.hidden = true;

    this.handle.addEventListener('mousedown', (event) => event.preventDefault());
    this.handle.addEventListener('click', this.select);
    this.handle.addEventListener('dragstart', this.dragStart);
    this.handle.addEventListener('mouseenter', this.cancelHide);
    this.handle.addEventListener('mouseleave', this.scheduleHide);
    view.dom.addEventListener('mousemove', this.track);
    view.dom.addEventListener('mouseleave', this.scheduleHide);
    view.dom.parentElement?.appendChild(this.handle);
  }

  private readonly cancelHide = () => {
    window.clearTimeout(this.hideTimer);
  };

  private readonly scheduleHide = () => {
    this.cancelHide();
    this.hideTimer = window.setTimeout(() => {
      this.handle.hidden = true;
      this.tablePos = undefined;
      this.wrapper = undefined;
    }, HIDE_DELAY_MS);
  };

  private readonly track = (event: MouseEvent) => {
    const target = event.target;
    const wrapper = target instanceof Element ? target.closest('.tableWrapper') : null;
    if (!(wrapper instanceof HTMLElement) || !this.view.editable) {
      if (this.wrapper !== undefined) {
        this.scheduleHide();
      }
      return;
    }
    this.cancelHide();
    this.wrapper = wrapper;
    this.tablePos = tablePosOf(this.view, wrapper);
    this.place();
  };

  private place() {
    const parent = this.handle.parentElement;
    if (this.wrapper === undefined || parent === null || this.tablePos === undefined) {
      this.handle.hidden = true;
      return;
    }
    const scale = Number.parseFloat(window.getComputedStyle(this.view.dom).getPropertyValue('--page-scale')) || 1;
    const table = this.wrapper.getBoundingClientRect();
    const frame = parent.getBoundingClientRect();
    this.handle.style.top = `${(table.top - frame.top) / scale}px`;
    this.handle.style.left = `${(table.left - frame.left) / scale}px`;
    this.handle.hidden = false;
  }

  private selectNode(): boolean {
    if (this.tablePos === undefined) {
      return false;
    }
    const node = this.view.state.doc.nodeAt(this.tablePos);
    if (node?.type.spec.tableRole !== 'table') {
      return false;
    }
    this.view.dispatch(
      this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, this.tablePos)),
    );
    return true;
  }

  private readonly select = () => {
    if (this.selectNode()) {
      this.view.focus();
    }
  };

  private readonly dragStart = (event: DragEvent) => {
    if (event.dataTransfer === null || !this.selectNode()) {
      event.preventDefault();
      return;
    }
    const selection = this.view.state.selection;
    if (!(selection instanceof NodeSelection)) {
      return;
    }
    const slice = selection.content();
    const { dom, text } = this.view.serializeForClipboard(slice);
    event.dataTransfer.clearData();
    event.dataTransfer.setData('text/html', dom.innerHTML);
    event.dataTransfer.setData('text/plain', text);
    event.dataTransfer.effectAllowed = 'copyMove';
    if (this.wrapper !== undefined) {
      event.dataTransfer.setDragImage(this.wrapper, 0, 0);
    }
    this.view.dragging = { slice, move: true };
  };

  update() {
    if (this.wrapper !== undefined && !this.wrapper.isConnected) {
      this.handle.hidden = true;
      this.wrapper = undefined;
      this.tablePos = undefined;
    } else if (this.wrapper !== undefined) {
      this.tablePos = tablePosOf(this.view, this.wrapper);
      this.place();
    }
  }

  destroy() {
    this.cancelHide();
    this.view.dom.removeEventListener('mousemove', this.track);
    this.view.dom.removeEventListener('mouseleave', this.scheduleHide);
    this.handle.remove();
  }
}

export const TableHandle = Extension.create({
  name: 'zekkeTableHandle',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('zekke-table-handle'),
        view: (view) => new TableHandleView(view),
      }),
    ];
  },
});
