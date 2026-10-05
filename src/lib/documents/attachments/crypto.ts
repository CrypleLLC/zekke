import { bytesToHex, zeroBytes } from '@/lib/encoding';
import { openChunk, sealChunk } from '@/lib/files/chunks';
import { layoutFor } from '@/lib/files/layout';
import { sha256 } from '@noble/hashes/sha2.js';

export const ATTACHMENT_KEY_BYTES = 32;

export class AttachmentTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`an attachment is one chunk; ${bytes} bytes do not fit in one`);
    this.name = 'AttachmentTooLargeError';
  }
}

export class AttachmentDigestError extends Error {
  constructor(expected: string, found: string) {
    super(`this image does not match the hash recorded for it (expected ${expected}, got ${found})`);
    this.name = 'AttachmentDigestError';
  }
}

export interface SealedAttachment {
  sealed: Uint8Array;
  sha256: string;
  storedBytes: number;
}

export function generateAttachmentKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(ATTACHMENT_KEY_BYTES));
}

export function storedAttachmentBytes(plaintextBytes: number): number {
  const layout = layoutFor(plaintextBytes);
  if (layout.chunkCount !== 1) {
    throw new AttachmentTooLargeError(plaintextBytes);
  }
  return layout.storedBytes;
}

export async function sealAttachment(bytes: Uint8Array, key: Uint8Array): Promise<SealedAttachment> {
  const layout = layoutFor(bytes.length);
  if (layout.chunkCount !== 1) {
    throw new AttachmentTooLargeError(bytes.length);
  }

  const padded = new Uint8Array(layout.paddedBytes);
  padded.set(bytes);

  try {
    const sealed = await sealChunk(padded, 0, 1, key);
    return { sealed, sha256: bytesToHex(sha256(sealed)), storedBytes: sealed.length };
  } finally {
    zeroBytes(padded);
  }
}

export async function openAttachment(
  sealed: Uint8Array,
  key: Uint8Array,
  plaintextBytes: number,
  expectedSha256?: string,
): Promise<Uint8Array> {
  if (expectedSha256 !== undefined) {
    const found = bytesToHex(sha256(sealed));
    if (found !== expectedSha256) {
      throw new AttachmentDigestError(expectedSha256, found);
    }
  }

  const padded = await openChunk(sealed, 0, 1, key);
  if (plaintextBytes > padded.length) {
    throw new Error(`this image claims ${plaintextBytes} bytes and its object holds ${padded.length}`);
  }
  return padded.slice(0, plaintextBytes);
}
