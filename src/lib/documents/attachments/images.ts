import { ApiError } from '@/lib/api';
import { zeroBytes } from '@/lib/encoding';
import { openAttachment } from './crypto';
import { attachmentKey, type AttachmentEntry } from './map';
import type { AttachmentDownloadRecord } from './records';

export class AttachmentUnavailableError extends Error {
  constructor(readonly id: string) {
    super('this image is not available — it may still be uploading from another device, or it was removed');
    this.name = 'AttachmentUnavailableError';
  }
}

export class AttachmentKeyMissingError extends Error {
  constructor(readonly id: string) {
    super('this image belongs to another document');
    this.name = 'AttachmentKeyMissingError';
  }
}

export interface AttachmentImageSource {
  entry(id: string): AttachmentEntry | undefined;
  download(id: string): Promise<AttachmentDownloadRecord>;
}

export interface OpenedImage {
  url: string;
  mime: string;
}

export class AttachmentImages {
  private readonly opened = new Map<string, Promise<OpenedImage>>();
  private readonly urls = new Set<string>();
  private closed = false;

  constructor(
    private readonly source: AttachmentImageSource,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  open(id: string): Promise<OpenedImage> {
    this.closed = false;
    const held = this.opened.get(id);
    if (held !== undefined) {
      return held;
    }

    const pending = this.load(id).catch((error: unknown) => {
      this.opened.delete(id);
      throw error;
    });
    this.opened.set(id, pending);
    return pending;
  }

  adopt(id: string, bytes: Uint8Array, mime: string): OpenedImage {
    this.closed = false;
    const blob = new Blob([bytes.slice()], { type: mime });
    const opened = { url: this.track(URL.createObjectURL(blob)), mime };
    rememberImage(id, blob);
    this.opened.set(id, Promise.resolve(opened));
    return opened;
  }

  forget(id: string): void {
    const held = this.opened.get(id);
    this.opened.delete(id);
    void held?.then((image) => this.revoke(image.url)).catch(() => undefined);
  }

  close(): void {
    this.closed = true;
    for (const url of this.urls) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
    this.opened.clear();
  }

  private async load(id: string): Promise<OpenedImage> {
    const entry = this.source.entry(id);
    if (entry === undefined) {
      throw new AttachmentKeyMissingError(id);
    }

    let download: AttachmentDownloadRecord;
    try {
      download = await this.source.download(id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new AttachmentUnavailableError(id);
      }
      throw error;
    }

    const response = await this.fetchImpl(download.url);
    if (!response.ok) {
      throw new AttachmentUnavailableError(id);
    }
    const sealed = new Uint8Array(await response.arrayBuffer());

    const key = attachmentKey(entry);
    let bytes: Uint8Array | undefined;
    try {
      bytes = await openAttachment(sealed, key, entry.size, download.ciphertext_sha256);
      const blob = new Blob([bytes.slice()], { type: entry.mime });
      rememberImage(id, blob);
      if (this.closed) {
        throw new Error('the document was closed');
      }
      return { url: this.track(URL.createObjectURL(blob)), mime: entry.mime };
    } finally {
      zeroBytes(key, bytes);
    }
  }

  private track(url: string): string {
    this.urls.add(url);
    return url;
  }

  private revoke(url: string): void {
    if (this.urls.delete(url)) {
      URL.revokeObjectURL(url);
    }
  }
}

const REMEMBERED_IMAGES = 32;
const remembered = new Map<string, Blob>();

export function rememberImage(id: string, blob: Blob): void {
  remembered.delete(id);
  remembered.set(id, blob);
  while (remembered.size > REMEMBERED_IMAGES) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    remembered.delete(oldest);
  }
}

export function recallImage(id: string): Blob | undefined {
  return remembered.get(id);
}

export function forgetRememberedImages(): void {
  remembered.clear();
}
