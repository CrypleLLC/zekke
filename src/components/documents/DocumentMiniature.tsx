'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import { DOMSerializer, Node as PMNode, type Schema } from '@tiptap/pm/model';
import type { AuthedContext } from '@/lib/context';
import type { FirstPage, MiniatureImage } from '@/lib/documents';
import {
  attachmentKey,
  getAttachmentDownload,
  openAttachment,
  safeImageAlignment,
  safeImageDimension,
  safeImageShare,
} from '@/lib/documents/attachments';
import { documentBaseFont } from '@/lib/document-styles';
import { PAGE_HEIGHT_MM, PAGE_WIDTH_MM, PAGE_WIDTH_PX, pageMargins } from '@/lib/document-page';
import { zeroBytes } from '@/lib/encoding';
import { useAuthedContext } from '@/components/session/ZekkeProvider';
import { documentExtensions } from './extensions';
import { DOCUMENT_FONT_VARIABLES } from './fonts';

const PAGE_HEIGHT_PX = (PAGE_WIDTH_PX * PAGE_HEIGHT_MM) / PAGE_WIDTH_MM;
const LOAD_MARGIN = '200px';

let schema: Schema | undefined;

function documentSchema(): Schema {
  schema ??= getSchema(documentExtensions(new Y.Doc()));
  return schema;
}

const thumbnails = new Map<string, Promise<string>>();

function thumbnailUrl(context: AuthedContext, documentId: string, image: MiniatureImage): Promise<string> {
  const held = thumbnails.get(image.thumbnailId);
  if (held !== undefined) {
    return held;
  }

  const pending = (async () => {
    const download = await getAttachmentDownload(context, documentId, image.thumbnailId);
    const response = await fetch(download.url);
    if (!response.ok) {
      throw new Error(`thumbnail ${image.thumbnailId} is not available`);
    }
    const key = attachmentKey(image.thumbnail);
    let bytes: Uint8Array | undefined;
    try {
      bytes = await openAttachment(
        new Uint8Array(await response.arrayBuffer()),
        key,
        image.thumbnail.size,
        download.ciphertext_sha256,
      );
      return URL.createObjectURL(new Blob([bytes.slice()], { type: image.thumbnail.mime }));
    } finally {
      zeroBytes(key, bytes);
    }
  })().catch((error: unknown) => {
    thumbnails.delete(image.thumbnailId);
    throw error;
  });

  thumbnails.set(image.thumbnailId, pending);
  return pending;
}

export default function DocumentMiniature({ documentId, page }: { documentId: string; page: FirstPage }) {
  const context = useAuthedContext();
  const frame = useRef<HTMLSpanElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = frame.current;
    if (element === null) {
      return;
    }
    const resize = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / PAGE_WIDTH_PX));
    resize.observe(element);
    const appear = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
        }
      },
      { rootMargin: LOAD_MARGIN },
    );
    appear.observe(element);
    return () => {
      resize.disconnect();
      appear.disconnect();
    };
  }, []);

  useEffect(() => {
    const element = sheet.current;
    if (element === null || !visible) {
      return;
    }
    element.replaceChildren(renderContent(page));
  }, [page, visible]);

  useEffect(() => {
    const element = sheet.current;
    if (element === null || !visible || page.images.length === 0) {
      return;
    }

    let cancelled = false;
    for (const image of page.images) {
      void thumbnailUrl(context, documentId, image)
        .then((url) => {
          if (cancelled) {
            return;
          }
          for (const img of element.querySelectorAll<HTMLImageElement>('img[data-attachment]')) {
            if (img.getAttribute('data-attachment') === image.id) {
              img.src = url;
            }
          }
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [context, documentId, page, visible]);

  const margins = pageMargins(page.margins);

  return (
    <span ref={frame} aria-hidden="true" className="pointer-events-none absolute inset-0 block overflow-hidden">
      <div
        ref={sheet}
        className={`${DOCUMENT_FONT_VARIABLES} zekke-prose zekke-miniature`}
        style={
          {
            width: PAGE_WIDTH_PX,
            height: PAGE_HEIGHT_PX,
            padding: `${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`,
            fontFamily: documentBaseFont(page.font),
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
            visibility: scale > 0 ? 'visible' : 'hidden',
          } as CSSProperties
        }
      />
    </span>
  );
}

function renderContent(page: FirstPage): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (page.content.length === 0) {
    return fragment;
  }

  let node: PMNode;
  try {
    node = PMNode.fromJSON(documentSchema(), { type: 'doc', content: page.content });
  } catch {
    return fragment;
  }

  const rendered = DOMSerializer.fromSchema(documentSchema()).serializeFragment(node.content);
  for (const img of rendered.querySelectorAll<HTMLImageElement>('img[data-attachment]')) {
    placeImage(img);
  }
  fragment.append(rendered);
  return fragment;
}

function placeImage(img: HTMLImageElement): void {
  const width = safeImageDimension(img.getAttribute('data-width'));
  const height = safeImageDimension(img.getAttribute('data-height'));
  const align = safeImageAlignment(img.getAttribute('data-align'));
  img.style.display = 'block';
  img.style.width = `${safeImageShare(img.getAttribute('data-share')) * 100}%`;
  img.style.aspectRatio = `${width} / ${height}`;
  img.style.objectFit = 'contain';
  img.style.background = 'var(--color-raised)';
  img.style.marginLeft = align === 'left' ? '0' : 'auto';
  img.style.marginRight = align === 'right' ? '0' : 'auto';
}
