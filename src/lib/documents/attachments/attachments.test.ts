import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newTestContext } from '@/test/session';
import { bytesToHex } from '@/lib/encoding';
import { sha256 } from '@noble/hashes/sha2.js';
import { BODY_FRAGMENT } from '../content';
import {
  AttachmentDigestError,
  AttachmentImages,
  AttachmentKeyMissingError,
  AttachmentTooLargeError,
  AttachmentUnavailableError,
  ImageRefusedError,
  MAX_COPY_BATCH,
  assertInsertableImage,
  attachmentKey,
  chooseEncoding,
  copySharedAttachments,
  encodeAttachmentKey,
  fittedExtent,
  generateAttachmentKey,
  hasAttachments,
  initialImageShare,
  resizedImageShare,
  safeAltText,
  safeImageAlignment,
  safeImageDimension,
  safeImageShare,
  imageAttachmentIds,
  openAttachment,
  preparedExtent,
  readAttachmentEntry,
  recallImage,
  referencedAttachmentIds,
  remapAttachments,
  sealAttachment,
  storedAttachmentBytes,
  storedAttachmentIds,
  thumbnailExtentFor,
  planAttachment,
  planImage,
  uploadAttachment,
  writeAttachmentEntry,
  type AttachmentEntry,
} from './index';
import { ApiError } from '@/lib/api';

const DOCUMENT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const IMAGE_ID = '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const THUMB_ID = '6c2f3d4e-5b6a-4c7d-9e8f-0a1b2c3d4e5f';
const SHARE_ID = '0e2a4c6e-8b0d-4f4a-8c8e-0b2d4f6a8c02';

function entry(overrides: Partial<AttachmentEntry> = {}): AttachmentEntry {
  return {
    key: encodeAttachmentKey(new Uint8Array(32).fill(7)),
    size: 1000,
    stored: 65573,
    mime: 'image/webp',
    width: 800,
    height: 600,
    ...overrides,
  };
}

function docWithImages(...ids: string[]): Y.Doc {
  const doc = new Y.Doc();
  const body = doc.getXmlFragment(BODY_FRAGMENT);
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText('before')]);
  body.insert(0, [paragraph]);
  for (const id of ids) {
    const image = new Y.XmlElement('image');
    image.setAttribute('attachment', id);
    body.insert(body.length, [image]);
  }
  return doc;
}

interface FakeResponse {
  status: number;
  body?: unknown;
}

function mockFetch(...responses: FakeResponse[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const spec = responses[Math.min(index++, responses.length - 1)];
      return {
        status: spec.status,
        ok: spec.status >= 200 && spec.status < 300,
        text: async () =>
          spec.body === undefined ? '' : JSON.stringify({ message: 'ok', data: spec.body }),
        headers: { get: () => null },
      } as unknown as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the attachment map', () => {
  it('keeps one entry per attachment, and ignores what is not one', () => {
    const doc = new Y.Doc();
    writeAttachmentEntry(doc, IMAGE_ID, entry({ thumbnail: THUMB_ID }));
    doc.getMap('attachments').set('junk', { key: 3 });

    expect(readAttachmentEntry(doc, IMAGE_ID)).toEqual(entry({ thumbnail: THUMB_ID }));
    expect(readAttachmentEntry(doc, 'junk')).toBeUndefined();
    expect(storedAttachmentIds(doc)).toEqual([IMAGE_ID]);
    expect(hasAttachments(doc)).toBe(true);
  });

  it('lives in its own top-level map, so two devices adding images never overwrite each other', () => {
    const left = new Y.Doc();
    const right = new Y.Doc();
    writeAttachmentEntry(left, IMAGE_ID, entry());
    writeAttachmentEntry(right, THUMB_ID, entry());

    Y.applyUpdate(left, Y.encodeStateAsUpdate(right));

    expect(storedAttachmentIds(left)).toEqual([IMAGE_ID, THUMB_ID].sort());
  });

  it('finds image nodes anywhere in the body, nested in tables included', () => {
    const doc = docWithImages(IMAGE_ID, IMAGE_ID);
    const table = new Y.XmlElement('table');
    const cell = new Y.XmlElement('tableCell');
    const nested = new Y.XmlElement('image');
    nested.setAttribute('attachment', THUMB_ID);
    cell.insert(0, [nested]);
    table.insert(0, [cell]);
    doc.getXmlFragment(BODY_FRAGMENT).insert(0, [table]);

    expect(imageAttachmentIds(doc)).toEqual([THUMB_ID, IMAGE_ID]);
  });

  it('references what the text shows and each shown image’s thumbnail, and nothing else', () => {
    const doc = docWithImages(IMAGE_ID);
    const removed = '7d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60';
    writeAttachmentEntry(doc, IMAGE_ID, entry({ thumbnail: THUMB_ID }));
    writeAttachmentEntry(doc, THUMB_ID, entry());
    writeAttachmentEntry(doc, removed, entry());

    expect(referencedAttachmentIds(doc)).toEqual([IMAGE_ID, THUMB_ID].sort());
  });

  it('does not reference an image node whose key this document lacks', () => {
    const doc = docWithImages(IMAGE_ID);

    expect(referencedAttachmentIds(doc)).toEqual([]);
  });

  it('refuses a key of the wrong length', () => {
    expect(() => encodeAttachmentKey(new Uint8Array(16))).toThrow();
    expect(() => attachmentKey(entry({ key: 'AAAA' }))).toThrow();
  });
});

describe('remapping for a copy', () => {
  it('gives every referenced attachment a new id, in the map and in the text', () => {
    const doc = docWithImages(IMAGE_ID);
    writeAttachmentEntry(doc, IMAGE_ID, entry({ thumbnail: THUMB_ID, stored: 200000 }));
    writeAttachmentEntry(doc, THUMB_ID, entry({ stored: 65573 }));
    writeAttachmentEntry(doc, 'cafebabe-0000-4000-8000-000000000000', entry());
    const fresh = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002'];
    let next = 0;

    const remapped = remapAttachments(Y.encodeStateAsUpdate(doc), () => fresh[next++]);

    const copy = new Y.Doc();
    Y.applyUpdate(copy, remapped.snapshot);
    const newImage = remapped.pairs.find((pair) => pair.source_id === IMAGE_ID)!.id;
    const newThumb = remapped.pairs.find((pair) => pair.source_id === THUMB_ID)!.id;

    expect(remapped.pairs).toHaveLength(2);
    expect(remapped.storedBytes).toBe(265573);
    expect(imageAttachmentIds(copy)).toEqual([newImage]);
    expect(storedAttachmentIds(copy)).toEqual([newImage, newThumb].sort());
    expect(readAttachmentEntry(copy, newImage)?.thumbnail).toBe(newThumb);
    expect(readAttachmentEntry(copy, newImage)?.key).toBe(entry().key);
  });

  it('copies nothing from a document without images', () => {
    const doc = docWithImages();
    const remapped = remapAttachments(Y.encodeStateAsUpdate(doc));

    expect(remapped.pairs).toEqual([]);
    expect(remapped.storedBytes).toBe(0);
  });
});

describe('sealing an attachment', () => {
  it('pads to the drive’s bucket, seals one chunk, and opens back to the exact bytes', async () => {
    const key = generateAttachmentKey();
    const bytes = new Uint8Array(70_000).map((_, index) => index % 251);

    const sealed = await sealAttachment(bytes, key);

    expect(sealed.storedBytes).toBe(131072 + 37);
    expect(sealed.storedBytes).toBe(storedAttachmentBytes(bytes.length));
    expect(sealed.sha256).toBe(bytesToHex(sha256(sealed.sealed)));
    expect(await openAttachment(sealed.sealed, key, bytes.length, sealed.sha256)).toEqual(bytes);
  });

  it('refuses an object that is not the one recorded', async () => {
    const key = generateAttachmentKey();
    const sealed = await sealAttachment(new Uint8Array(10), key);

    await expect(openAttachment(sealed.sealed, key, 10, 'f'.repeat(64))).rejects.toBeInstanceOf(
      AttachmentDigestError,
    );
    await expect(openAttachment(sealed.sealed, generateAttachmentKey(), 10)).rejects.toThrow();
  });

  it('is one chunk, never a multipart', async () => {
    expect(() => storedAttachmentBytes(9 * 1024 * 1024)).toThrow(AttachmentTooLargeError);
  });
});

describe('preparing an image', () => {
  it('refuses SVG, unknown types and anything over 5 MB as given', () => {
    expect(() => assertInsertableImage({ size: 10, type: 'image/svg+xml' })).toThrow(ImageRefusedError);
    expect(() => assertInsertableImage({ size: 10, type: 'application/pdf' })).toThrow(/Only JPEG/);
    expect(() => assertInsertableImage({ size: 5 * 1024 * 1024 + 1, type: 'image/png' })).toThrow(/5 MB/);
    expect(() => assertInsertableImage({ size: 5 * 1024 * 1024, type: 'image/jpeg' })).not.toThrow();
  });

  it('scales down to at most twice the continuous text width, never up', () => {
    expect(preparedExtent({ width: 4000, height: 3000 })).toEqual({ width: 1996, height: 1497 });
    expect(preparedExtent({ width: 640, height: 480 })).toEqual({ width: 640, height: 480 });
    expect(preparedExtent({ width: 1000, height: 20000 }).height).toBe(8000);
    expect(fittedExtent({ width: 0, height: 10 }, 100)).toEqual({ width: 0, height: 0 });
  });

  it('derives a small thumbnail', () => {
    expect(thumbnailExtentFor({ width: 4000, height: 3000 })).toEqual({ width: 480, height: 360 });
  });

  it('prefers WebP, keeps PNG only for transparency and only when it is smaller, never JPEG with alpha', () => {
    const webp = { mime: 'image/webp', size: 500 };
    const png = { mime: 'image/png', size: 400 };
    const jpeg = { mime: 'image/jpeg', size: 300 };

    expect(chooseEncoding([webp, jpeg], false)).toBe(webp);
    expect(chooseEncoding([jpeg], false)).toBe(jpeg);
    expect(chooseEncoding([webp, png], true)).toBe(png);
    expect(chooseEncoding([{ ...webp, size: 300 }, png], true)?.mime).toBe('image/webp');
    expect(chooseEncoding([png, jpeg], true)).toBe(png);
    expect(chooseEncoding([jpeg], true)).toBeUndefined();
  });
});

describe('uploading an attachment', () => {
  const picture = { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'image/webp', width: 2, height: 2 };

  it('plans the key and the sealed size before anything is sent, so the entry can be written first', () => {
    const planned = planImage(
      { image: picture, thumbnail: { ...picture, width: 1 } },
      { image: IMAGE_ID, thumbnail: THUMB_ID },
    );

    expect(planned.image.entry).toMatchObject({ size: 4, stored: 65573, thumbnail: THUMB_ID });
    expect(planned.thumbnail.entry.thumbnail).toBeUndefined();
    expect(planned.image.entry.key).not.toBe(planned.thumbnail.entry.key);
  });

  it('reserves the sealed size, puts the bytes, then completes with their hash', async () => {
    const context = await newTestContext();
    const calls = mockFetch(
      { status: 201, body: { id: IMAGE_ID, state: 'pending', upload: { url: 'https://r2.test/put', size: 65573 } } },
      { status: 200, body: { id: IMAGE_ID, state: 'ok' } },
    );
    const put = vi.fn(async () => undefined);
    const planned = planAttachment(IMAGE_ID, picture);

    await uploadAttachment(context, DOCUMENT_ID, planned, picture.bytes, { put });

    expect(calls[0].url).toContain(`/documents/${DOCUMENT_ID}/attachments`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ id: IMAGE_ID, size_bytes: 65573 });
    const sent = (put.mock.calls[0] as unknown as [string, Uint8Array])[1];
    expect(sent.length).toBe(65573);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ ciphertext_sha256: bytesToHex(sha256(sent)) });
    expect(await openAttachment(sent, attachmentKey(planned.entry), 4)).toEqual(picture.bytes);
  });

  it('gives the reservation back when the bytes do not land', async () => {
    const context = await newTestContext();
    const calls = mockFetch(
      { status: 201, body: { id: IMAGE_ID, state: 'pending', upload: { url: 'https://r2.test/put', size: 65573 } } },
      { status: 404 },
    );

    await expect(
      uploadAttachment(context, DOCUMENT_ID, planAttachment(IMAGE_ID, picture), picture.bytes, {
        put: async () => {
          throw new Error('network');
        },
      }),
    ).rejects.toThrow('network');
    expect(calls[1].init.method).toBe('DELETE');
    expect(calls[1].url).toContain(`/attachments/${IMAGE_ID}/upload`);
  });

  it('treats a retry of an upload that already landed as done, and a different object as an error', async () => {
    const context = await newTestContext();
    const planned = planAttachment(IMAGE_ID, picture);
    const { sha256: digest } = await sealAttachment(picture.bytes, attachmentKey(planned.entry));

    mockFetch({ status: 200, body: { id: IMAGE_ID, state: 'ok', ciphertext_sha256: digest } });
    await expect(uploadAttachment(context, DOCUMENT_ID, planned, picture.bytes)).resolves.toBeUndefined();

    mockFetch({ status: 200, body: { id: IMAGE_ID, state: 'ok', ciphertext_sha256: 'f'.repeat(64) } });
    await expect(uploadAttachment(context, DOCUMENT_ID, planned, picture.bytes)).rejects.toThrow(
      /different content/,
    );
  });
});

describe('copying a shared document’s images', () => {
  it('sends the pairs in batches the server accepts', async () => {
    const context = await newTestContext();
    const calls = mockFetch({ status: 200, body: { attachments: [] } });
    const pairs = Array.from({ length: MAX_COPY_BATCH + 1 }, (_, index) => ({
      source_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      id: `11111111-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));

    await copySharedAttachments(context, SHARE_ID, DOCUMENT_ID, pairs);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain(`/shares/${SHARE_ID}/attachments/copy`);
    expect(JSON.parse(String(calls[0].init.body)).attachments).toHaveLength(MAX_COPY_BATCH);
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ document_id: DOCUMENT_ID });
  });
});

describe('opening images', () => {
  async function stored(bytes: Uint8Array) {
    const key = generateAttachmentKey();
    const sealed = await sealAttachment(bytes, key);
    return { sealed, entry: entry({ key: encodeAttachmentKey(key), size: bytes.length }) };
  }

  function fetchOf(body: Uint8Array, status = 200): typeof fetch {
    return vi.fn(async () => ({
      ok: status === 200,
      status,
      arrayBuffer: async () => body.slice().buffer,
    })) as unknown as typeof fetch;
  }

  it('downloads, checks, opens once, and hands out one blob URL per image', async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const { sealed, entry: stored_ } = await stored(bytes);
    const download = vi.fn(async () => ({
      url: 'https://r2.test/get',
      ciphertext_sha256: sealed.sha256,
    }));
    const images = new AttachmentImages(
      { entry: () => stored_, download: download as never },
      fetchOf(sealed.sealed),
    );

    const first = await images.open(IMAGE_ID);
    const second = await images.open(IMAGE_ID);

    expect(first.url).toMatch(/^blob:/);
    expect(second).toBe(first);
    expect(download).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await recallImage(IMAGE_ID)!.arrayBuffer())).toEqual(bytes);
    images.close();
  });

  it('says an image from another document is that, without asking the server', async () => {
    const download = vi.fn();
    const images = new AttachmentImages({ entry: () => undefined, download });

    await expect(images.open(IMAGE_ID)).rejects.toBeInstanceOf(AttachmentKeyMissingError);
    expect(download).not.toHaveBeenCalled();
  });

  it('turns a 404 into "not available yet", and tries again on the next open', async () => {
    const download = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ code: 'NOT_FOUND', status: 404, endpoint: 'GET x' }))
      .mockRejectedValueOnce(new Error('offline'));
    const images = new AttachmentImages({ entry: () => entry(), download });

    await expect(images.open(IMAGE_ID)).rejects.toBeInstanceOf(AttachmentUnavailableError);
    await expect(images.open(IMAGE_ID)).rejects.toThrow('offline');
    expect(download).toHaveBeenCalledTimes(2);
  });
});

describe('placing an image', () => {
  it('stores its width as a share of the text width, between 5 % and all of it', () => {
    expect(safeImageShare(0.5)).toBe(0.5);
    expect(safeImageShare('0.25')).toBe(0.25);
    expect(safeImageShare(4)).toBe(1);
    expect(safeImageShare(0)).toBe(0.05);
    expect(safeImageShare('url(x)')).toBe(1);
  });

  it('accepts three alignments and nothing else', () => {
    expect(safeImageAlignment('right')).toBe('right');
    expect(safeImageAlignment('justify')).toBe('center');
  });

  it('keeps alt text a bounded string and dimensions positive integers', () => {
    expect(safeAltText(3)).toBe('');
    expect(safeAltText('x'.repeat(900))).toHaveLength(500);
    expect(safeImageDimension('640')).toBe(640);
    expect(safeImageDimension(-3)).toBe(1);
  });

  it('starts at the size the prepared image was made for, never wider than the text', () => {
    expect(initialImageShare(998)).toBe(0.5);
    expect(initialImageShare(1996)).toBe(1);
    expect(initialImageShare(5000)).toBe(1);
  });

  it('grows from the handle dragged, twice as fast when centred, and stops at the text width', () => {
    expect(resizedImageShare(400, 100, 1000, 'left', 'right')).toBe(0.5);
    expect(resizedImageShare(400, -100, 1000, 'right', 'left')).toBe(0.5);
    expect(resizedImageShare(400, 100, 1000, 'center', 'right')).toBe(0.6);
    expect(resizedImageShare(900, 500, 1000, 'left', 'right')).toBe(1);
    expect(resizedImageShare(100, -500, 1000, 'left', 'right')).toBe(0.05);
  });
});
