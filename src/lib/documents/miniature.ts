import type * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { BODY_FRAGMENT, readDocumentFont, readPageMargins } from './content';
import { readAttachmentEntry, type AttachmentEntry } from './attachments/map';
import { IMAGE_ATTACHMENT_ATTRIBUTE, IMAGE_NODE } from './attachments/records';

export const MINIATURE_MAX_BLOCKS = 60;
export const MINIATURE_MAX_CHARACTERS = 4000;
const PAGE_BREAK_NODE = 'pageBreak';
const DROPPED_MARKS = new Set(['link']);

export interface MiniatureNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: MiniatureNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface MiniatureImage {
  id: string;
  thumbnailId: string;
  thumbnail: AttachmentEntry;
}

export interface FirstPage {
  content: MiniatureNode[];
  margins: unknown;
  font?: string;
  images: MiniatureImage[];
}

export function readFirstPage(
  doc: Y.Doc,
  limits: { maxBlocks?: number; maxCharacters?: number } = {},
): FirstPage {
  const maxBlocks = limits.maxBlocks ?? MINIATURE_MAX_BLOCKS;
  const maxCharacters = limits.maxCharacters ?? MINIATURE_MAX_CHARACTERS;
  const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(BODY_FRAGMENT)) as MiniatureNode;

  const content: MiniatureNode[] = [];
  let characters = 0;
  for (const block of json.content ?? []) {
    if (block.type === PAGE_BREAK_NODE || content.length >= maxBlocks || characters >= maxCharacters) {
      break;
    }
    const cleaned = withoutDroppedMarks(block);
    content.push(cleaned);
    characters += textLength(cleaned);
  }

  return {
    content,
    margins: readPageMargins(doc),
    font: readDocumentFont(doc),
    images: imagesOf(doc, content),
  };
}

function withoutDroppedMarks(node: MiniatureNode): MiniatureNode {
  const copy: MiniatureNode = { type: node.type };
  if (node.attrs !== undefined) {
    copy.attrs = { ...node.attrs };
  }
  if (node.text !== undefined) {
    copy.text = node.text;
  }
  if (node.marks !== undefined) {
    const marks = node.marks.filter((mark) => !DROPPED_MARKS.has(mark.type));
    if (marks.length > 0) {
      copy.marks = marks;
    }
  }
  if (node.content !== undefined) {
    copy.content = node.content.map(withoutDroppedMarks);
  }
  return copy;
}

function textLength(node: MiniatureNode): number {
  return (node.text?.length ?? 0) + (node.content ?? []).reduce((sum, child) => sum + textLength(child), 0);
}

function imagesOf(doc: Y.Doc, content: readonly MiniatureNode[]): MiniatureImage[] {
  const images: MiniatureImage[] = [];
  const seen = new Set<string>();

  const visit = (node: MiniatureNode) => {
    if (node.type === IMAGE_NODE) {
      const id = node.attrs?.[IMAGE_ATTACHMENT_ATTRIBUTE];
      if (typeof id === 'string' && !seen.has(id)) {
        seen.add(id);
        const thumbnailId = readAttachmentEntry(doc, id)?.thumbnail;
        const thumbnail = thumbnailId === undefined ? undefined : readAttachmentEntry(doc, thumbnailId);
        if (thumbnailId !== undefined && thumbnail !== undefined) {
          images.push({ id, thumbnailId, thumbnail });
        }
      }
    }
    node.content?.forEach(visit);
  };

  content.forEach(visit);
  return images;
}
