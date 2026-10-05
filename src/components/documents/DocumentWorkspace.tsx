'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Doc as YDoc } from 'yjs';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isSpreadsheet } from '@/lib/spreadsheets/layout';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import {
  META_MAP,
  readDocumentFont,
  type SyncState,
} from '@/lib/documents';
import { documentBaseFont } from '@/lib/document-styles';
import {
  documentCountsLabel,
  documentHref,
  PRIVATE_TEXT_ATTRIBUTES,
  readDocumentView,
  saveStatusLabel,
  UNTITLED_DOCUMENT,
  writeDocumentView,
  type DocumentView,
} from '@/lib/app';
import { Notice, Spinner } from '@/components/ui';
import { documentExtensions } from './extensions';
import { DOCUMENT_FONT_VARIABLES } from './fonts';
import { pageCountOf } from './pagination';
import DocumentToolbar from './DocumentToolbar';
import DocumentOutline from './DocumentOutline';
import { useDocumentSync } from './useDocumentSync';
import { SaveStatus, TitleInput } from './ItemHeader';

export default function DocumentWorkspace({ id }: { id: string }) {
  const { sync, state, error } = useDocumentSync(id);

  if (error !== undefined) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <Notice tone="danger">
          <strong className="font-medium">This document could not be opened.</strong> {error}
        </Notice>
        <p className="mt-6 text-sm">
          <Link href="/" className="text-brand-700 hover:underline">
            Back to your vault
          </Link>
        </p>
      </main>
    );
  }

  if (sync === undefined || isSpreadsheet(sync.doc)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ground">
        {sync !== undefined && <MovedTo href={documentHref(id, 'spreadsheet')} />}
        <Spinner />
      </main>
    );
  }

  return <DocumentSurface doc={sync.doc} state={state} />;
}

function MovedTo({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(href);
  }, [router, href]);

  return null;
}

function DocumentSurface({ doc, state }: { doc: YDoc; state: SyncState }) {
  const [view, setView] = useDocumentView();
  const [startsPaginated] = useState(view === 'pages');
  const editor = useEditor({
    extensions: documentExtensions(doc, { paginated: startsPaginated }),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'zekke-prose focus:outline-none',
        ...PRIVATE_TEXT_ATTRIBUTES,
      },
    },
  });
  const chrome = useChromeHeight();
  const pages = usePageCount(editor);
  const baseFont = useDocumentBaseFont(doc);

  useEffect(() => {
    if (editor !== null && !editor.isDestroyed) {
      editor.commands.setPaginated(view === 'pages');
    }
  }, [editor, view]);

  return (
    <main className={`${DOCUMENT_FONT_VARIABLES} min-h-screen bg-ground`}>
      <header
        ref={chrome}
        className="zekke-no-print sticky top-[var(--staging-banner-h)] z-10 border-b border-line bg-surface/90 backdrop-blur"
      >
        <div className="flex items-center gap-3 px-3 pt-2.5">
          <Link href="/" aria-label="Back to your vault" className="shrink-0">
            <Image src="/zekke-logo.png" alt="Zekke" width={28} height={28} priority />
          </Link>
          <div className="min-w-0 flex-1">
            <TitleInput doc={doc} label="Document title" placeholder={UNTITLED_DOCUMENT} />
            <SaveStatus
              label={saveStatusLabel(state.status, state.pending)}
              gapDetected={state.gapDetected}
              gapMessage="Some updates are missing — this document will not be compacted"
            />
          </div>
          <DocumentCounts editor={editor} pages={pages} />
        </div>
        <DocumentToolbar editor={editor} baseFont={baseFont} view={view} onViewChange={setView} />
      </header>

      <div className="zekke-page-frame mx-auto flex max-w-[1180px] items-start gap-6 px-4 py-8">
        <DocumentOutline editor={editor} />
        <div className="min-w-0 flex-1 lg:flex lg:justify-center">
          <div
            className="zekke-page-stack"
            data-view={view}
            style={{ '--page-count': pages ?? 1 } as CSSProperties}
          >
            <div aria-hidden="true" className="zekke-page-sheets">
              {Array.from({ length: view === 'pages' ? (pages ?? 1) : 0 }, (_, page) => (
                <div key={page} className="zekke-sheet" />
              ))}
            </div>
            <div className="zekke-page" style={{ fontFamily: baseFont }}>
              <EditorContent editor={editor} className="zekke-page-body" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function useDocumentView(): [DocumentView, (view: DocumentView) => void] {
  const [view, setView] = useState<DocumentView>(() => readDocumentView());

  const choose = useCallback((next: DocumentView) => {
    setView(next);
    writeDocumentView(next);
  }, []);

  return [view, choose];
}

function useDocumentBaseFont(doc: YDoc): string {
  const [font, setFont] = useState(() => documentBaseFont(readDocumentFont(doc)));

  useEffect(() => {
    const meta = doc.getMap(META_MAP);
    const observer = () => setFont(documentBaseFont(readDocumentFont(doc)));

    observer();
    meta.observe(observer);
    return () => meta.unobserve(observer);
  }, [doc]);

  return font;
}

function useChromeHeight() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = ref.current;
    if (header === null) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty(
        '--doc-chrome-h',
        `${entry.contentRect.height}px`,
      );
    });

    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--doc-chrome-h');
    };
  }, []);

  return ref;
}

function usePageCount(editor: Editor | null): number | undefined {
  return (
    useEditorState({
      editor,
      selector: () => pageCountOf(editor),
    }) ?? undefined
  );
}

const COUNTS_DEBOUNCE_MS = 400;

interface DocumentCountsValue {
  words: number;
  characters: number;
}

function useDocumentCounts(editor: Editor | null): DocumentCountsValue | undefined {
  const [counts, setCounts] = useState<DocumentCountsValue>();

  useEffect(() => {
    if (editor === null) {
      setCounts(undefined);
      return;
    }

    let timer = 0;
    const read = () =>
      setCounts({
        words: editor.storage.characterCount.words() as number,
        characters: editor.storage.characterCount.characters() as number,
      });
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, COUNTS_DEBOUNCE_MS);
    };

    read();
    editor.on('update', schedule);

    return () => {
      window.clearTimeout(timer);
      editor.off('update', schedule);
    };
  }, [editor]);

  return counts;
}

function DocumentCounts({ editor, pages }: { editor: Editor | null; pages: number | undefined }) {
  const counts = useDocumentCounts(editor);

  if (counts === undefined) {
    return null;
  }

  return (
    <p className="hidden shrink-0 text-caption normal-case tracking-normal text-ink-muted sm:block">
      {documentCountsLabel(counts.words, counts.characters, pages)}
    </p>
  );
}
