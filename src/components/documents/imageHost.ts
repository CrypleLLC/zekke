import type * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import { ApiError } from '@/lib/api';
import type { AuthedContext } from '@/lib/context';
import {
  AttachmentImages,
  IMAGE_NODE,
  ImageRefusedError,
  getAttachmentDownload,
  initialImageShare,
  planImage,
  prepareImage,
  readAttachmentEntry,
  recallImage,
  uploadPlannedImage,
  writeAttachmentEntry,
  type PlannedImage,
  type PreparedImage,
} from '@/lib/documents/attachments';

export type ImageUploadStatus = { kind: 'uploading' } | { kind: 'failed'; message: string };

interface PendingUpload {
  planned: PlannedImage;
  prepared: PreparedImage;
  status: ImageUploadStatus;
}

export interface LoadableImage {
  load(): Promise<void>;
}

export class DocumentImageHost {
  readonly images: AttachmentImages;
  private editor?: Editor;
  private readonly uploads = new Map<string, PendingUpload>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly adopting = new Map<string, Promise<boolean>>();
  private readonly views = new Set<LoadableImage>();

  constructor(
    private readonly context: AuthedContext,
    private readonly documentId: string,
    private readonly doc: Y.Doc,
    private readonly notify: (message: string) => void,
  ) {
    this.images = new AttachmentImages({
      entry: (id) => readAttachmentEntry(doc, id),
      download: (id) => getAttachmentDownload(context, documentId, id),
    });
  }

  attach(editor: Editor | null): void {
    this.editor = editor ?? undefined;
  }

  status(id: string): ImageUploadStatus | undefined {
    return this.uploads.get(id)?.status;
  }

  subscribe(id: string, listener: () => void): () => void {
    const set = this.listeners.get(id) ?? new Set();
    set.add(listener);
    this.listeners.set(id, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(id);
      }
    };
  }

  register(view: LoadableImage): () => void {
    this.views.add(view);
    return () => this.views.delete(view);
  }

  async loadAll(): Promise<void> {
    await Promise.allSettled([...this.views].map((view) => view.load()));
  }

  async insertFiles(files: readonly File[], position?: number): Promise<void> {
    let at = position;
    for (const file of files) {
      let prepared: PreparedImage;
      try {
        prepared = await prepareImage(file);
      } catch (error) {
        this.notify(error instanceof ImageRefusedError ? error.message : 'This image could not be read.');
        continue;
      }

      const planned = this.adopt(prepared);
      const editor = this.editor;
      if (editor === undefined || editor.isDestroyed) {
        return;
      }

      const node = {
        type: IMAGE_NODE,
        attrs: {
          attachment: planned.image.id,
          width: prepared.image.width,
          height: prepared.image.height,
          share: initialImageShare(prepared.image.width),
          align: 'center',
          alt: '',
        },
      };
      if (at === undefined) {
        editor.chain().focus().insertContent(node).run();
      } else {
        editor.chain().focus().insertContentAt(at, node).run();
        at = undefined;
      }

      void this.upload(planned.image.id);
    }
  }

  retry(id: string): void {
    if (this.uploads.has(id)) {
      void this.upload(id);
    }
  }

  adoptForeign(id: string): Promise<boolean> {
    const held = this.adopting.get(id);
    if (held !== undefined) {
      return held;
    }
    const pending = this.reupload(id);
    this.adopting.set(id, pending);
    return pending;
  }

  close(): void {
    this.images.close();
  }

  private adopt(prepared: PreparedImage): PlannedImage {
    const planned = planImage(prepared);
    this.doc.transact(() => {
      writeAttachmentEntry(this.doc, planned.thumbnail.id, planned.thumbnail.entry);
      writeAttachmentEntry(this.doc, planned.image.id, planned.image.entry);
    });
    this.images.adopt(planned.image.id, prepared.image.bytes, prepared.image.mime);
    this.uploads.set(planned.image.id, { planned, prepared, status: { kind: 'uploading' } });
    return planned;
  }

  private async reupload(id: string): Promise<boolean> {
    const remembered = recallImage(id);
    const editor = this.editor;
    if (remembered === undefined || editor === undefined) {
      return false;
    }

    let prepared: PreparedImage;
    try {
      prepared = await prepareImage(new File([remembered], 'image', { type: remembered.type }));
    } catch {
      return false;
    }

    const planned = this.adopt(prepared);
    if (editor.isDestroyed) {
      return false;
    }

    const { state } = editor;
    const transaction = state.tr;
    state.doc.descendants((node, pos) => {
      if (node.type.name === IMAGE_NODE && node.attrs.attachment === id) {
        transaction.setNodeMarkup(pos, undefined, { ...node.attrs, attachment: planned.image.id });
      }
    });
    if (transaction.docChanged) {
      editor.view.dispatch(transaction);
    }

    void this.upload(planned.image.id);
    return true;
  }

  private async upload(id: string): Promise<void> {
    const pending = this.uploads.get(id);
    if (pending === undefined) {
      return;
    }

    this.setStatus(id, { kind: 'uploading' });
    try {
      await uploadPlannedImage(this.context, this.documentId, pending.planned, pending.prepared);
      this.uploads.delete(id);
      this.emit(id);
    } catch (error) {
      this.setStatus(id, { kind: 'failed', message: uploadFailure(error) });
    }
  }

  private setStatus(id: string, status: ImageUploadStatus): void {
    const pending = this.uploads.get(id);
    if (pending !== undefined) {
      pending.status = status;
      this.emit(id);
    }
  }

  private emit(id: string): void {
    for (const listener of this.listeners.get(id) ?? []) {
      listener();
    }
  }
}

export function uploadFailure(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'QUOTA_EXCEEDED':
        return 'Your storage is full. Images in documents count against it.';
      case 'TOO_MANY_REQUESTS':
        return 'Too many images at once. Try again in a moment.';
      case 'NOT_FOUND':
        return 'Images are not available on this server.';
    }
  }
  return 'This image could not be uploaded.';
}

export async function printDocument(host: DocumentImageHost | undefined): Promise<void> {
  await host?.loadAll();
  window.print();
}
