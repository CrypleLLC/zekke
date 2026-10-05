import type { AuthedContext } from '@/lib/context';
import { zeroBytes } from '@/lib/encoding';
import { abandonAttachment, completeAttachment, createAttachment } from './api';
import { generateAttachmentKey, sealAttachment, storedAttachmentBytes } from './crypto';
import { attachmentKey, encodeAttachmentKey, type AttachmentEntry } from './map';
import type { PreparedImage, PreparedPicture } from './prepare';

export class AttachmentUploadError extends Error {
  constructor(readonly status: number) {
    super(`the image upload was refused by storage (${status})`);
    this.name = 'AttachmentUploadError';
  }
}

export type AttachmentPutter = (url: string, body: Uint8Array, signal?: AbortSignal) => Promise<void>;

export const fetchAttachmentPutter: AttachmentPutter = async (url, body, signal) => {
  const response = await fetch(url, { method: 'PUT', body: body as unknown as BodyInit, signal });
  if (!response.ok) {
    throw new AttachmentUploadError(response.status);
  }
};

export interface AttachmentUploadOptions {
  put?: AttachmentPutter;
  signal?: AbortSignal;
}

export interface PlannedAttachment {
  id: string;
  entry: AttachmentEntry;
}

export interface PlannedImage {
  image: PlannedAttachment;
  thumbnail: PlannedAttachment;
}

export function planAttachment(id: string, picture: PreparedPicture): PlannedAttachment {
  const key = generateAttachmentKey();
  try {
    return {
      id,
      entry: {
        key: encodeAttachmentKey(key),
        size: picture.bytes.length,
        stored: storedAttachmentBytes(picture.bytes.length),
        mime: picture.mime,
        width: picture.width,
        height: picture.height,
      },
    };
  } finally {
    zeroBytes(key);
  }
}

export function planImage(
  prepared: PreparedImage,
  ids: { image: string; thumbnail: string } = {
    image: crypto.randomUUID(),
    thumbnail: crypto.randomUUID(),
  },
): PlannedImage {
  const thumbnail = planAttachment(ids.thumbnail, prepared.thumbnail);
  const image = planAttachment(ids.image, prepared.image);

  return { image: { id: image.id, entry: { ...image.entry, thumbnail: thumbnail.id } }, thumbnail };
}

export async function uploadAttachment(
  context: AuthedContext,
  documentId: string,
  planned: PlannedAttachment,
  bytes: Uint8Array,
  options: AttachmentUploadOptions = {},
): Promise<void> {
  if (bytes.length !== planned.entry.size) {
    throw new Error(`attachment ${planned.id} was planned for ${planned.entry.size} bytes, not ${bytes.length}`);
  }

  const key = attachmentKey(planned.entry);
  try {
    const { sealed, sha256, storedBytes } = await sealAttachment(bytes, key);
    const { attachment } = await createAttachment(context, documentId, {
      id: planned.id,
      size_bytes: storedBytes,
    });

    if (attachment.upload === undefined) {
      if (attachment.state === 'ok' && attachment.ciphertext_sha256 === sha256) {
        return;
      }
      throw new Error(`attachment ${planned.id} is stored with different content`);
    }

    try {
      await (options.put ?? fetchAttachmentPutter)(attachment.upload.url, sealed, options.signal);
      await completeAttachment(context, documentId, planned.id, sha256);
    } catch (error) {
      await abandonAttachment(context, documentId, planned.id).catch(() => undefined);
      throw error;
    }
  } finally {
    zeroBytes(key);
  }
}

export async function uploadPlannedImage(
  context: AuthedContext,
  documentId: string,
  planned: PlannedImage,
  prepared: PreparedImage,
  options: AttachmentUploadOptions = {},
): Promise<void> {
  await uploadAttachment(context, documentId, planned.thumbnail, prepared.thumbnail.bytes, options);
  await uploadAttachment(context, documentId, planned.image, prepared.image.bytes, options);
}
