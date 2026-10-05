import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { BODY_FRAGMENT, writePageMargins } from './content';
import { writeAttachmentEntry } from './attachments/map';
import { readFirstPage } from './miniature';

const IMAGE = '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const THUMB = '6c2f3d4e-5b6a-4c7d-9e8f-0a1b2c3d4e5f';
const ENTRY = {
  key: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
  size: 10,
  stored: 65573,
  mime: 'image/webp',
  width: 4,
  height: 3,
};

function paragraph(text: string, marks?: Record<string, unknown>): Y.XmlElement {
  const element = new Y.XmlElement('paragraph');
  const content = new Y.XmlText();
  content.insert(0, text, marks);
  element.insert(0, [content]);
  return element;
}

function body(doc: Y.Doc, ...blocks: Y.XmlElement[]) {
  doc.getXmlFragment(BODY_FRAGMENT).insert(0, blocks);
}

describe('the first page of a document', () => {
  it('stops at the first page break', () => {
    const doc = new Y.Doc();
    body(doc, paragraph('first'), new Y.XmlElement('pageBreak'), paragraph('second page'));

    const page = readFirstPage(doc);

    expect(page.content.map((node) => node.type)).toEqual(['paragraph']);
  });

  it('stops once it holds more than a page could, by blocks or by characters', () => {
    const doc = new Y.Doc();
    body(doc, ...Array.from({ length: 10 }, (_, index) => paragraph(`line ${index}`)));

    expect(readFirstPage(doc, { maxBlocks: 3 }).content).toHaveLength(3);
    expect(readFirstPage(doc, { maxCharacters: 12 }).content).toHaveLength(2);
  });

  it('keeps colours and fonts, and drops links', () => {
    const doc = new Y.Doc();
    body(
      doc,
      paragraph('styled', {
        textStyle: { color: '#b91c1c', fontFamily: null, fontSize: null },
        link: { href: 'https://example.com' },
      }),
    );

    const [block] = readFirstPage(doc).content;
    const marks = block.content?.[0].marks?.map((mark) => mark.type);

    expect(marks).toEqual(['textStyle']);
  });

  it('names the thumbnail of every image it shows, and only those', () => {
    const doc = new Y.Doc();
    const image = new Y.XmlElement('image');
    image.setAttribute('attachment', IMAGE);
    const later = new Y.XmlElement('image');
    later.setAttribute('attachment', 'later-image');
    body(doc, image, new Y.XmlElement('pageBreak'), later);
    writeAttachmentEntry(doc, IMAGE, { ...ENTRY, thumbnail: THUMB });
    writeAttachmentEntry(doc, THUMB, ENTRY);
    writeAttachmentEntry(doc, 'later-image', { ...ENTRY, thumbnail: THUMB });

    expect(readFirstPage(doc).images).toEqual([{ id: IMAGE, thumbnailId: THUMB, thumbnail: ENTRY }]);
  });

  it('carries the margins and font the page is laid out with', () => {
    const doc = new Y.Doc();
    writePageMargins(doc, { top: 30, right: 20, bottom: 20, left: 30 });

    expect(readFirstPage(doc).margins).toEqual({ top: 30, right: 20, bottom: 20, left: 30 });
  });
});
