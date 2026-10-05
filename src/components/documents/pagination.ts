import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import {
  pageCount,
  paginate,
  samePagination,
  type PageStart,
  type PaginationBlock,
} from "@/lib/documents";
import { PAGE_BREAK_NAME } from "./pageBreak";

const GAP_CLASS = "zekke-page-gap";
const GAP_CURSOR_CLASS = "ProseMirror-gapcursor";
const MAX_PASSES = 4;

export const paginationKey = new PluginKey<PaginationState>("zekke-pagination");
const ENABLED_META = "zekke-pagination-enabled";

interface PaginationState {
  enabled: boolean;
  pages: number;
  starts: readonly PageStart[];
  decorations: DecorationSet;
}

type MeasuredPagination = Omit<PaginationState, "enabled">;

const EMPTY: MeasuredPagination = {
  pages: 1,
  starts: [],
  decorations: DecorationSet.empty,
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pagination: {
      setPaginated: (enabled: boolean) => ReturnType;
    };
  }
}

export function markPaginated(
  transaction: Transaction,
  enabled: boolean,
): Transaction {
  return transaction
    .setMeta(ENABLED_META, enabled)
    .setMeta("addToHistory", false);
}

export function isPaginated(state: EditorState): boolean {
  return paginationKey.getState(state)?.enabled ?? false;
}

export function documentPageCount(state: EditorState): number {
  return paginationKey.getState(state)?.pages ?? 1;
}

export function pageCountOf(editor: Editor | null): number | undefined {
  if (editor === null) {
    return 1;
  }
  return isPaginated(editor.state) ? documentPageCount(editor.state) : undefined;
}

export const Pagination = Extension.create<{ paginated: boolean }>({
  name: "ZekkePagination",

  addOptions() {
    return { paginated: true };
  },

  addCommands() {
    return {
      setPaginated:
        (enabled) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            markPaginated(tr, enabled);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [paginationPlugin(this.options.paginated)];
  },
});

export function paginationPlugin(paginated: boolean): Plugin<PaginationState> {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: () => ({ ...EMPTY, enabled: paginated }),
      apply(transaction, value) {
        const enabled = transaction.getMeta(ENABLED_META) as
          | boolean
          | undefined;
        if (enabled !== undefined && enabled !== value.enabled) {
          return { ...EMPTY, enabled };
        }
        const next = transaction.getMeta(paginationKey) as
          | MeasuredPagination
          | undefined;
        if (next !== undefined) {
          return value.enabled ? { ...next, enabled: true } : value;
        }
        if (transaction.docChanged) {
          return {
            ...value,
            decorations: value.decorations.map(
              transaction.mapping,
              transaction.doc,
            ),
          };
        }
        return value;
      },
    },
    props: {
      decorations: (state) => paginationKey.getState(state)?.decorations,
    },
    view: (view) => new PaginationView(view),
  });
}

class PaginationView {
  private readonly view: EditorView;
  private readonly observer: ResizeObserver;
  private queued = false;
  private passes = 0;
  private measured = new WeakMap<PMNode, PaginationBlock>();
  private width = -1;
  private geometry?: PageGeometry;
  private measuredDoc?: PMNode;
  private enabled: boolean;

  constructor(view: EditorView) {
    this.view = view;
    this.enabled = isPaginated(view.state);
    this.observer = new ResizeObserver(() => this.schedule(true));
    this.observer.observe(view.dom);
    this.schedule(true);
    void document.fonts?.ready.then(() => {
      this.invalidate();
      this.schedule(true);
    });
  }

  private invalidate() {
    this.measured = new WeakMap();
    this.geometry = undefined;
    this.measuredDoc = undefined;
  }

  update() {
    const enabled = isPaginated(this.view.state);
    if (enabled !== this.enabled) {
      this.enabled = enabled;
      this.invalidate();
      this.width = -1;
      this.schedule(true);
      return;
    }
    this.schedule(false);
  }

  destroy() {
    this.observer.disconnect();
  }

  private schedule(reset: boolean) {
    if (reset) {
      this.passes = 0;
    }
    if (this.queued) {
      return;
    }
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.measure();
    });
  }

  private measure() {
    const view = this.view;
    if (
      view.isDestroyed ||
      !isPaginated(view.state) ||
      this.passes >= MAX_PASSES
    ) {
      return;
    }

    const width = view.dom.clientWidth;
    if (width !== this.width) {
      this.width = width;
      this.invalidate();
    }

    const current = paginationKey.getState(view.state) ?? {
      ...EMPTY,
      enabled: true,
    };
    if (view.state.doc === this.measuredDoc) {
      this.passes = 0;
      return;
    }

    const geometry = this.geometry ?? pageGeometry(view.dom);
    if (geometry === undefined) {
      return;
    }
    this.geometry = geometry;

    const blocks = readBlocks(view, this.measured);
    if (blocks === undefined) {
      return;
    }

    const starts = paginate(blocks.metrics, geometry.content);
    this.measuredDoc = view.state.doc;

    const anchors = starts.map((start) => blocks.positions[start.index]);
    if (
      samePagination(current.starts, starts) &&
      sameAnchors(current.decorations, anchors)
    ) {
      this.passes = 0;
      return;
    }

    this.passes += 1;

    const decorations = DecorationSet.create(
      view.state.doc,
      starts.map((start, page) => {
        const height = Math.max(
          0,
          start.fill + geometry.gutter - blocks.metrics[start.index].spacing,
        );
        return Decoration.widget(anchors[page], () => gapElement(height), {
          side: -1,
          key: `${GAP_CLASS}:${page}:${height.toFixed(2)}`,
          ignoreSelection: true,
        });
      }),
    );

    view.dispatch(
      view.state.tr
        .setMeta(paginationKey, {
          pages: pageCount(starts),
          starts,
          decorations,
        })
        .setMeta("addToHistory", false),
    );
  }
}

function sameAnchors(
  decorations: DecorationSet,
  anchors: readonly number[],
): boolean {
  const live = decorations.find();
  return (
    live.length === anchors.length &&
    live.every((decoration, index) => decoration.from === anchors[index])
  );
}

function gapElement(height: number): HTMLElement {
  const element = document.createElement("div");
  element.className = GAP_CLASS;
  element.style.height = `${height}px`;
  element.contentEditable = "false";
  element.setAttribute("aria-hidden", "true");
  return element;
}

interface BlockReading {
  metrics: PaginationBlock[];
  positions: number[];
}

function readBlocks(
  view: EditorView,
  measured: WeakMap<PMNode, PaginationBlock>,
): BlockReading | undefined {
  const doc = view.state.doc;
  const elements = contentElements(view);
  if (elements === undefined) {
    return undefined;
  }

  const metrics: PaginationBlock[] = new Array<PaginationBlock>(doc.childCount);
  const positions: number[] = new Array<number>(doc.childCount);
  let index = 0;

  doc.forEach((node, offset) => {
    positions[index] = offset;

    const cached = index > 0 ? measured.get(node) : undefined;
    if (cached !== undefined) {
      metrics[index] = cached;
      index += 1;
      return;
    }

    const dom = elements[index];
    const block: PaginationBlock = {
      height: dom.getBoundingClientRect().height,
      spacing:
        index === 0
          ? 0
          : Number.parseFloat(window.getComputedStyle(dom).marginTop) || 0,
      keepWithNext: node.type.name === "heading",
      breaksAfter: node.type.name === PAGE_BREAK_NAME,
    };

    metrics[index] = block;
    if (index > 0) {
      measured.set(node, block);
    }
    index += 1;
  });

  return metrics.length === 0 ? undefined : { metrics, positions };
}

function contentElements(view: EditorView): HTMLElement[] | undefined {
  const elements: HTMLElement[] = [];

  for (const child of view.dom.children) {
    if (
      !(child instanceof HTMLElement) ||
      child.classList.contains(GAP_CLASS) ||
      child.classList.contains(GAP_CURSOR_CLASS)
    ) {
      continue;
    }
    elements.push(child);
  }

  if (elements.length === view.state.doc.childCount) {
    return elements;
  }

  return elementsByPosition(view);
}

function elementsByPosition(view: EditorView): HTMLElement[] | undefined {
  const elements: HTMLElement[] = [];
  let failed = false;

  view.state.doc.forEach((_node, offset) => {
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) {
      failed = true;
      return;
    }
    elements.push(dom);
  });

  return failed ? undefined : elements;
}

interface PageGeometry {
  content: number;
  gutter: number;
}

function pageGeometry(dom: HTMLElement): PageGeometry | undefined {
  const page = dom.closest<HTMLElement>(".zekke-page");
  if (page === null) {
    return undefined;
  }

  const margin =
    Number.parseFloat(window.getComputedStyle(page).paddingTop) || 0;
  const content = probe(page, "var(--page-height)") - margin * 2;

  return content > 0
    ? { content, gutter: margin * 2 + probe(page, "var(--page-gap)") }
    : undefined;
}

function probe(page: HTMLElement, value: string): number {
  const element = document.createElement("div");
  element.style.cssText = `position:absolute;visibility:hidden;width:0;height:${value}`;
  page.appendChild(element);
  const height = element.getBoundingClientRect().height;
  element.remove();
  return height;
}
