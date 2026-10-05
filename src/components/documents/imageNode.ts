import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import { PRIVATE_TEXT_ATTRIBUTES } from '@/lib/app';
import {
  AttachmentKeyMissingError,
  AttachmentUnavailableError,
  IMAGE_ALIGNMENTS,
  IMAGE_NODE,
  MAX_ALT_TEXT_CHARACTERS,
  resizedImageShare,
  safeAltText,
  safeImageAlignment,
  safeImageDimension,
  safeImageShare,
  type ImageAlignment,
} from '@/lib/documents/attachments';
import type { DocumentImageHost } from './imageHost';

const LOAD_MARGIN = '800px';
const ALIGNMENT_LABELS: Record<ImageAlignment, string> = {
  left: 'Align image left',
  center: 'Centre image',
  right: 'Align image right',
};

export interface DocumentImageOptions {
  host?: DocumentImageHost;
}

export const DocumentImage = Node.create<DocumentImageOptions>({
  name: IMAGE_NODE,
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { host: undefined };
  },

  addAttributes() {
    return {
      attachment: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-attachment'),
        renderHTML: (attributes) =>
          typeof attributes.attachment === 'string' ? { 'data-attachment': attributes.attachment } : {},
      },
      width: {
        default: 1,
        parseHTML: (element) => safeImageDimension(element.getAttribute('data-width')),
        renderHTML: (attributes) => ({ 'data-width': String(safeImageDimension(attributes.width)) }),
      },
      height: {
        default: 1,
        parseHTML: (element) => safeImageDimension(element.getAttribute('data-height')),
        renderHTML: (attributes) => ({ 'data-height': String(safeImageDimension(attributes.height)) }),
      },
      share: {
        default: 1,
        parseHTML: (element) => safeImageShare(element.getAttribute('data-share')),
        renderHTML: (attributes) => ({ 'data-share': String(safeImageShare(attributes.share)) }),
      },
      align: {
        default: 'center',
        parseHTML: (element) => safeImageAlignment(element.getAttribute('data-align')),
        renderHTML: (attributes) => ({ 'data-align': safeImageAlignment(attributes.align) }),
      },
      alt: {
        default: '',
        parseHTML: (element) => safeAltText(element.getAttribute('alt')),
        renderHTML: (attributes) => ({ alt: safeAltText(attributes.alt) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[data-attachment]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { class: 'zekke-image-copy' })];
  },

  addNodeView() {
    const host = this.options.host;
    return ({ node, view, getPos }) =>
      new ImageNodeView(node, view, getPos as () => number | undefined, host);
  },

  addProseMirrorPlugins() {
    const host = this.options.host;
    if (host === undefined) {
      return [];
    }

    return [
      new Plugin({
        key: new PluginKey('zekke-image-input'),
        props: {
          handlePaste: (_view, event) => {
            const files = imageFiles(event.clipboardData);
            if (files.length === 0) {
              return false;
            }
            void host.insertFiles(files);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) {
              return false;
            }
            const files = imageFiles(event.dataTransfer);
            if (files.length === 0) {
              return false;
            }
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            event.preventDefault();
            void host.insertFiles(files, at);
            return true;
          },
        },
      }),
    ];
  },
});

function imageFiles(transfer: DataTransfer | null): File[] {
  if (transfer === null) {
    return [];
  }
  return [...transfer.files].filter((file) => file.type.startsWith('image/'));
}

type ViewState =
  | { kind: 'waiting' }
  | { kind: 'shown'; url: string }
  | { kind: 'unavailable' }
  | { kind: 'foreign' }
  | { kind: 'failed' };

class ImageNodeView implements NodeView {
  readonly dom: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly overlay: HTMLElement;
  private readonly tools: HTMLElement;
  private readonly altInput: HTMLInputElement;
  private readonly alignButtons = new Map<ImageAlignment, HTMLButtonElement>();
  private readonly observer?: IntersectionObserver;
  private node: PMNode;
  private state: ViewState = { kind: 'waiting' };
  private visible = false;
  private loading?: Promise<void>;
  private unsubscribe?: () => void;
  private unregister?: () => void;
  private resizing = false;

  constructor(
    node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly host: DocumentImageHost | undefined,
  ) {
    this.node = node;

    this.dom = document.createElement('div');
    this.dom.className = 'zekke-image';
    this.dom.contentEditable = 'false';
    this.dom.draggable = true;

    this.frame = document.createElement('div');
    this.frame.className = 'zekke-image-frame';

    this.image = document.createElement('img');
    this.image.draggable = false;
    this.image.decoding = 'async';

    this.overlay = document.createElement('div');
    this.overlay.className = 'zekke-image-state';

    this.frame.append(this.image, this.overlay);
    for (const side of ['left', 'right'] as const) {
      this.frame.append(this.resizeHandle(side));
    }

    this.tools = document.createElement('div');
    this.tools.className = 'zekke-image-tools zekke-no-print';
    for (const alignment of IMAGE_ALIGNMENTS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'zekke-image-tool';
      button.setAttribute('aria-label', ALIGNMENT_LABELS[alignment]);
      button.title = ALIGNMENT_LABELS[alignment];
      button.append(alignmentGlyph(alignment));
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => this.setAttrs({ align: alignment }));
      this.alignButtons.set(alignment, button);
      this.tools.append(button);
    }
    this.altInput = document.createElement('input');
    this.altInput.type = 'text';
    this.altInput.className = 'zekke-image-alt';
    this.altInput.placeholder = 'Describe this image';
    this.altInput.maxLength = MAX_ALT_TEXT_CHARACTERS;
    this.altInput.setAttribute('aria-label', 'Alternative text');
    this.altInput.autocomplete = 'off';
    for (const [name, value] of Object.entries(PRIVATE_TEXT_ATTRIBUTES)) {
      this.altInput.setAttribute(name, value);
    }
    this.altInput.addEventListener('change', () => this.setAttrs({ alt: safeAltText(this.altInput.value) }));
    this.altInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        if (event.key === 'Enter') {
          this.setAttrs({ alt: safeAltText(this.altInput.value) });
        }
        this.view.focus();
      }
    });
    this.tools.append(this.altInput);

    this.dom.append(this.frame, this.tools);
    this.applyAttrs();

    if (host !== undefined) {
      this.unregister = host.register(this);
      this.subscribe();
      if (typeof IntersectionObserver === 'function') {
        this.observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              this.visible = true;
              void this.load();
            }
          },
          { rootMargin: LOAD_MARGIN },
        );
        this.observer.observe(this.dom);
      } else {
        this.visible = true;
        void this.load();
      }
    }
    this.render();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    const previous = this.node.attrs.attachment;
    this.node = node;
    this.applyAttrs();
    if (node.attrs.attachment !== previous) {
      this.state = { kind: 'waiting' };
      this.loading = undefined;
      this.subscribe();
      if (this.visible) {
        void this.load();
      }
    }
    this.render();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('is-selected');
    this.altInput.value = safeAltText(this.node.attrs.alt);
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected');
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (!(target instanceof globalThis.Node)) {
      return false;
    }
    if (this.tools.contains(target)) {
      return true;
    }
    if (target instanceof HTMLElement && target.classList.contains('zekke-image-handle')) {
      return true;
    }
    return this.resizing;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.observer?.disconnect();
    this.unsubscribe?.();
    this.unregister?.();
  }

  load(): Promise<void> {
    if (this.loading !== undefined) {
      return this.loading;
    }
    const id = this.attachment();
    if (id === undefined || this.host === undefined) {
      return Promise.resolve();
    }

    const host = this.host;
    this.loading = host.images
      .open(id)
      .then((opened) => {
        this.state = { kind: 'shown', url: opened.url };
        return this.whenDecoded();
      })
      .catch(async (error: unknown) => {
        if (error instanceof AttachmentKeyMissingError) {
          const adopted = await host.adoptForeign(id);
          this.state = adopted ? { kind: 'waiting' } : { kind: 'foreign' };
        } else if (error instanceof AttachmentUnavailableError) {
          this.state = { kind: 'unavailable' };
          this.loading = undefined;
        } else {
          this.state = { kind: 'failed' };
          this.loading = undefined;
        }
      })
      .finally(() => this.render());

    return this.loading;
  }

  private whenDecoded(): Promise<void> {
    this.render();
    return this.image.decode().catch(() => undefined);
  }

  private attachment(): string | undefined {
    const id = this.node.attrs.attachment;
    return typeof id === 'string' && id !== '' ? id : undefined;
  }

  private subscribe(): void {
    this.unsubscribe?.();
    const id = this.attachment();
    if (id === undefined || this.host === undefined) {
      return;
    }
    this.unsubscribe = this.host.subscribe(id, () => this.render());
  }

  private applyAttrs(): void {
    const width = safeImageDimension(this.node.attrs.width);
    const height = safeImageDimension(this.node.attrs.height);
    const align = safeImageAlignment(this.node.attrs.align);
    this.dom.dataset.align = align;
    this.frame.style.width = `${safeImageShare(this.node.attrs.share) * 100}%`;
    this.frame.style.aspectRatio = `${width} / ${height}`;
    this.image.alt = safeAltText(this.node.attrs.alt);
    for (const [alignment, button] of this.alignButtons) {
      button.setAttribute('aria-pressed', String(alignment === align));
    }
  }

  private render(): void {
    const id = this.attachment();
    const upload = id === undefined ? undefined : this.host?.status(id);

    if (this.state.kind === 'shown') {
      if (this.image.getAttribute('src') !== this.state.url) {
        this.image.src = this.state.url;
      }
      this.image.hidden = false;
    } else {
      this.image.removeAttribute('src');
      this.image.hidden = true;
    }

    this.overlay.replaceChildren();
    this.overlay.hidden = false;
    this.frame.dataset.state = upload?.kind ?? this.state.kind;

    if (upload?.kind === 'uploading') {
      this.overlay.append(label('Uploading…'));
    } else if (upload?.kind === 'failed') {
      this.overlay.append(label(upload.message), this.action('Retry', () => this.host?.retry(id!)));
    } else if (this.state.kind === 'unavailable') {
      this.overlay.append(
        label('This image is not available yet. It may still be uploading from another device.'),
        this.action('Try again', () => void this.load()),
      );
    } else if (this.state.kind === 'foreign') {
      this.overlay.append(label('This image came from another document. Insert it again.'));
    } else if (this.state.kind === 'failed') {
      this.overlay.append(label('This image could not be opened.'), this.action('Try again', () => void this.load()));
    } else if (this.state.kind === 'shown') {
      this.overlay.hidden = true;
    }
  }

  private action(text: string, run: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'zekke-image-action';
    button.textContent = text;
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      run();
    });
    return button;
  }

  private resizeHandle(side: 'left' | 'right'): HTMLElement {
    const handle = document.createElement('span');
    handle.className = 'zekke-image-handle zekke-no-print';
    handle.dataset.side = side;
    handle.setAttribute('aria-hidden', 'true');

    handle.addEventListener('pointerdown', (event) => {
      if (!this.view.editable) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      this.resizing = true;

      const startX = event.clientX;
      const startWidth = this.frame.getBoundingClientRect().width;
      const textWidth = this.dom.getBoundingClientRect().width;
      const align = safeImageAlignment(this.node.attrs.align);
      let share = safeImageShare(this.node.attrs.share);

      const move = (moved: PointerEvent) => {
        share = resizedImageShare(startWidth, moved.clientX - startX, textWidth, align, side);
        this.frame.style.width = `${share * 100}%`;
      };
      const finish = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        this.resizing = false;
        this.setAttrs({ share });
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
    });

    return handle;
  }

  private setAttrs(attrs: Record<string, unknown>): void {
    const pos = this.getPos();
    if (pos === undefined || !this.view.editable) {
      return;
    }
    const transaction = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...attrs });
    transaction.setSelection(NodeSelection.create(transaction.doc, pos));
    this.view.dispatch(transaction);
  }
}

function label(text: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'zekke-image-label';
  element.textContent = text;
  return element;
}

function alignmentGlyph(alignment: ImageAlignment): SVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const x = alignment === 'left' ? 2 : alignment === 'center' ? 4 : 6;
  const lines: [number, number, number][] = [
    [2, 3, 12],
    [x, 7, 8],
    [2, 11, 12],
  ];
  for (const [left, top, width] of lines) {
    const rect = document.createElementNS(namespace, 'rect');
    rect.setAttribute('x', String(left));
    rect.setAttribute('y', String(top));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', top === 7 ? '3' : '1.5');
    rect.setAttribute('rx', '0.5');
    rect.setAttribute('fill', 'currentColor');
    svg.append(rect);
  }
  return svg;
}
