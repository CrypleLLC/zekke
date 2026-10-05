import * as Y from 'yjs';
import { base64ToBytes, bytesToBase64 } from '@/lib/encoding';
import { BODY_FRAGMENT } from '../content';
import { ATTACHMENTS_MAP, IMAGE_ATTACHMENT_ATTRIBUTE, IMAGE_NODE } from './records';

export interface AttachmentEntry {
  key: string;
  size: number;
  stored: number;
  mime: string;
  width: number;
  height: number;
  thumbnail?: string;
}

const KEY_BYTES = 32;

export function attachmentMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(ATTACHMENTS_MAP);
}

export function readAttachmentEntry(doc: Y.Doc, id: string): AttachmentEntry | undefined {
  return parseEntry(attachmentMap(doc).get(id));
}

export function writeAttachmentEntry(
  doc: Y.Doc,
  id: string,
  entry: AttachmentEntry,
  origin?: unknown,
): void {
  doc.transact(() => {
    attachmentMap(doc).set(id, { ...entry });
  }, origin);
}

export function attachmentKey(entry: AttachmentEntry): Uint8Array {
  const key = base64ToBytes(entry.key);
  if (key.length !== KEY_BYTES) {
    throw new Error(`an attachment key is ${KEY_BYTES} bytes, this one is ${key.length}`);
  }
  return key;
}

export function encodeAttachmentKey(key: Uint8Array): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`an attachment key is ${KEY_BYTES} bytes, this one is ${key.length}`);
  }
  return bytesToBase64(key);
}

export function hasAttachments(doc: Y.Doc): boolean {
  return attachmentMap(doc).size > 0;
}

export function imageAttachmentIds(doc: Y.Doc): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  const visit = (node: Y.XmlFragment | Y.XmlElement) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) {
        continue;
      }
      if (child.nodeName === IMAGE_NODE) {
        const id = child.getAttribute(IMAGE_ATTACHMENT_ATTRIBUTE);
        if (typeof id === 'string' && id !== '' && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
      visit(child);
    }
  };

  visit(doc.getXmlFragment(BODY_FRAGMENT));
  return ids;
}

export function referencedAttachmentIds(doc: Y.Doc): string[] {
  const referenced = new Set<string>();

  for (const id of imageAttachmentIds(doc)) {
    const entry = readAttachmentEntry(doc, id);
    if (entry === undefined) {
      continue;
    }
    referenced.add(id);
    if (entry.thumbnail !== undefined && readAttachmentEntry(doc, entry.thumbnail) !== undefined) {
      referenced.add(entry.thumbnail);
    }
  }

  return [...referenced].sort();
}

export function storedAttachmentIds(doc: Y.Doc): string[] {
  const ids: string[] = [];
  attachmentMap(doc).forEach((value, id) => {
    if (parseEntry(value) !== undefined) {
      ids.push(id);
    }
  });
  return ids.sort();
}

export interface RemappedAttachments {
  snapshot: Uint8Array;
  pairs: { source_id: string; id: string }[];
  storedBytes: number;
}

export function remapAttachments(
  snapshot: Uint8Array,
  newId: () => string = () => crypto.randomUUID(),
): RemappedAttachments {
  const doc = new Y.Doc();

  try {
    Y.applyUpdate(doc, snapshot);

    const referenced = referencedAttachmentIds(doc);
    const mapping = new Map(referenced.map((id) => [id, newId()]));
    const pairs = referenced.map((id) => ({ source_id: id, id: mapping.get(id)! }));

    let storedBytes = 0;
    const map = attachmentMap(doc);
    const entries = new Map<string, AttachmentEntry>();
    for (const id of referenced) {
      const entry = readAttachmentEntry(doc, id)!;
      entries.set(id, entry);
      storedBytes += entry.stored;
    }

    doc.transact(() => {
      for (const id of [...map.keys()]) {
        map.delete(id);
      }
      for (const [id, entry] of entries) {
        const thumbnail = entry.thumbnail === undefined ? undefined : mapping.get(entry.thumbnail);
        const { thumbnail: _dropped, ...rest } = entry;
        map.set(mapping.get(id)!, thumbnail === undefined ? rest : { ...rest, thumbnail });
      }
      renameImageNodes(doc.getXmlFragment(BODY_FRAGMENT), mapping);
    });

    return { snapshot: Y.encodeStateAsUpdate(doc), pairs, storedBytes };
  } finally {
    doc.destroy();
  }
}

function renameImageNodes(node: Y.XmlFragment | Y.XmlElement, mapping: Map<string, string>): void {
  for (const child of node.toArray()) {
    if (!(child instanceof Y.XmlElement)) {
      continue;
    }
    if (child.nodeName === IMAGE_NODE) {
      const id = child.getAttribute(IMAGE_ATTACHMENT_ATTRIBUTE);
      const renamed = typeof id === 'string' ? mapping.get(id) : undefined;
      if (renamed !== undefined) {
        child.setAttribute(IMAGE_ATTACHMENT_ATTRIBUTE, renamed);
      }
    }
    renameImageNodes(child, mapping);
  }
}

function parseEntry(value: unknown): AttachmentEntry | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.key !== 'string' ||
    !isCount(entry.size) ||
    !isCount(entry.stored) ||
    typeof entry.mime !== 'string' ||
    !isCount(entry.width) ||
    !isCount(entry.height)
  ) {
    return undefined;
  }

  return {
    key: entry.key,
    size: entry.size,
    stored: entry.stored,
    mime: entry.mime,
    width: entry.width,
    height: entry.height,
    ...(typeof entry.thumbnail === 'string' ? { thumbnail: entry.thumbnail } : {}),
  };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
