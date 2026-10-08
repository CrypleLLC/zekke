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
  readPageMargins,
  writePageMargins,
  type SyncState,
} from '@/lib/documents';
import { documentBaseFont } from '@/lib/document-styles';
import {
  pageMarginVariables,
  pageMargins,
  printPageRule,
  sameMargins,
  type PageMargins,
} from '@/lib/document-page';
import {
  documentCountsLabel,
  documentHref,
  PRIVATE_TEXT_ATTRIBUTES,
  readDocumentView,
  readOutlineShown,
  readRulersShown,
  saveIndicator,
  saveIndicatorLabel,
  saveStatusLabel,
  UNTITLED_DOCUMENT,
  writeDocumentView,
  writeOutlineShown,
  writeRulersShown,
  type DocumentView,
} from '@/lib/app';
import { Notice, Spinner } from '@/components/ui';
import { documentExtensions } from './extensions';
import { DOCUMENT_FONT_VARIABLES } from './fonts';
import { pageCountOf } from './pagination';
import DocumentToolbar, { ViewControls } from './DocumentToolbar';
import { OutlineDrawer, OutlinePanel } from './DocumentOutline';
import { FormatDock, OutlineButton, SaveDot } from './MobileChrome';
import { useOutline, useScrolledHeading } from './useOutline';
import {
  useCoarsePointer,
  useEditing,
  useFocusWithin,
  useKeyboardInset,
  useQuickReturn,
  useWideLayout,
} from './useMobileChrome';
import { HorizontalRuler, VerticalRulers } from './PageRulers';
import { useRegionalPreferences } from '@/components/session/usePreferences';
import { TableContextMenu } from './TableContextMenu';
import { useDocumentSync } from './useDocumentSync';
import { DocumentImageHost, printDocument } from './imageHost';
import { useAuthedContext } from '@/components/session/ZekkeProvider';
import { usePageScale } from './usePageScale';
import { SaveStatus, TitleInput } from './ItemHeader';

const INSERTABLE_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp';
const GAP_MESSAGE = 'Some updates are missing — this document will not be compacted';
const CARET_CLEARANCE = { top: 120, right: 8, bottom: 96, left: 8 };

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

  return <DocumentSurface id={id} doc={sync.doc} state={state} />;
}

function MovedTo({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(href);
  }, [router, href]);

  return null;
}

function DocumentSurface({ id, doc, state }: { id: string; doc: YDoc; state: SyncState }) {
  const [view, setView] = useDocumentView();
  const [rulersShown, setRulersShown] = useRulersShown();
  const rulers = view === 'pages' && rulersShown;
  const [startsPaginated] = useState(view === 'pages');
  const context = useAuthedContext();
  const [imageNotice, setImageNotice] = useState<string>();
  const [imageHost] = useState(() => new DocumentImageHost(context, id, doc, setImageNotice));
  const imagePicker = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: documentExtensions(doc, { paginated: startsPaginated, images: imageHost }),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'zekke-prose focus:outline-none',
        ...PRIVATE_TEXT_ATTRIBUTES,
      },
      scrollThreshold: CARET_CLEARANCE,
      scrollMargin: CARET_CLEARANCE,
    },
  });
  const chrome = useChromeHeight();
  const stack = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const wide = useWideLayout();
  const pageScale = usePageScale(scroller, stack, view === 'pages', wide);
  const scaled = pageScale.scale < 1;
  const coarsePointer = useCoarsePointer();
  const docked = !wide && coarsePointer;
  const titleArea = useRef<HTMLDivElement>(null);
  const titleFocused = useFocusWithin(titleArea);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineShown, setOutlineShown] = useOutlineShown();
  const chromeHidden = useQuickReturn(docked, titleFocused || outlineOpen);
  const dock = useRef<HTMLDivElement>(null);
  const editing = useEditing(editor, dock);
  useKeyboardInset(docked);
  const outlineEntries = useOutline(editor);
  const activeHeading = useScrolledHeading(editor, outlineEntries);
  const pages = usePageCount(editor);
  const baseFont = useDocumentBaseFont(doc);
  const storedMargins = useDocumentPageMargins(doc);
  const [previewMargins, setPreviewMargins] = useState<PageMargins | null>(null);
  const { regional } = useRegionalPreferences();
  const margins = previewMargins ?? storedMargins;
  const commitMargins = useCallback(
    (next: PageMargins) => {
      setPreviewMargins(null);
      if (!sameMargins(next, storedMargins)) {
        writePageMargins(doc, next);
      }
    },
    [doc, storedMargins],
  );
  const cancelMargins = useCallback(() => setPreviewMargins(null), []);

  useEffect(() => {
    if (editor !== null && !editor.isDestroyed) {
      editor.commands.setPaginated(view === 'pages');
    }
  }, [editor, view]);

  useEffect(() => {
    imageHost.attach(editor);
    return () => imageHost.attach(null);
  }, [imageHost, editor]);

  useEffect(() => () => imageHost.close(), [imageHost]);

  const insertImage = useCallback(() => imagePicker.current?.click(), []);
  const print = useCallback(() => void printDocument(imageHost), [imageHost]);

  useEffect(() => {
    if (editor !== null && !editor.isDestroyed) {
      editor.commands.remeasurePagination();
    }
  }, [editor, margins.top, margins.bottom, pageScale.scale]);

  return (
    <main className={`${DOCUMENT_FONT_VARIABLES} min-h-screen bg-ground`}>
      <style>{printPageRule(storedMargins)}</style>
      <TableContextMenu editor={editor} />
      <input
        ref={imagePicker}
        type="file"
        accept={INSERTABLE_IMAGE_TYPES}
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          void imageHost.insertFiles(files);
        }}
      />
      {imageNotice !== undefined && (
        <div className="zekke-no-print fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex max-w-md items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink shadow-lift">
            <p className="min-w-0 flex-1">{imageNotice}</p>
            <button
              type="button"
              className="shrink-0 text-ink-muted hover:text-ink"
              onClick={() => setImageNotice(undefined)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <header
        ref={chrome}
        data-hidden={chromeHidden ? '' : undefined}
        className="zekke-no-print zekke-doc-chrome sticky top-[var(--staging-banner-h)] z-10 border-b border-line bg-surface/90 backdrop-blur"
      >
        <div className="flex items-center gap-1 px-2 py-1.5 docside:items-start docside:gap-3 docside:px-3 docside:py-2">
          <Link href="/" aria-label="Back to your vault" className="shrink-0">
            <Image src="/zekke-logo.png" alt="Zekke" width={28} height={28} priority />
          </Link>
          <div ref={titleArea} className="min-w-0 flex-1 docside:max-w-md docside:flex-none">
            <TitleInput
              doc={doc}
              label="Document title"
              placeholder={UNTITLED_DOCUMENT}
              compact={!wide}
              fit={wide}
            />
            {wide && (
              <SaveStatus
                label={saveStatusLabel(state.status, state.pending)}
                gapDetected={state.gapDetected}
                gapMessage={GAP_MESSAGE}
              />
            )}
          </div>
          {wide ? (
            <>
              <DocumentToolbar
                editor={editor}
                baseFont={baseFont}
                view={view}
                onViewChange={setView}
                rulersShown={rulersShown}
                onRulersShownChange={setRulersShown}
                onInsertImage={insertImage}
                onPrint={print}
                inline
              />
              <div className="shrink-0 pt-2">
                <DocumentCounts editor={editor} pages={pages} />
              </div>
            </>
          ) : (
            <>
              <SaveDot
                indicator={saveIndicator(state)}
                label={state.gapDetected ? GAP_MESSAGE : saveIndicatorLabel(state)}
              />
              {docked && (
                <div className="flex shrink-0 items-center">
                  <ViewControls
                    view={view}
                    onViewChange={setView}
                    rulersShown={rulersShown}
                    onRulersShownChange={setRulersShown}
                    onPrint={print}
                  />
                </div>
              )}
            </>
          )}
        </div>
        {!docked && !wide && (
          <DocumentToolbar
            editor={editor}
            baseFont={baseFont}
            view={view}
            onViewChange={setView}
            rulersShown={rulersShown}
            onRulersShownChange={setRulersShown}
            onInsertImage={insertImage}
            onPrint={print}
          />
        )}
      </header>

      {docked && (
        <FormatDock ref={dock} shown={editing}>
          <DocumentToolbar
            editor={editor}
            baseFont={baseFont}
            view={view}
            onViewChange={setView}
            rulersShown={rulersShown}
            onRulersShownChange={setRulersShown}
            onInsertImage={insertImage}
            onPrint={print}
            docked
          />
        </FormatDock>
      )}

      {!wide && outlineOpen && (
        <OutlineDrawer
          editor={editor}
          entries={outlineEntries}
          active={activeHeading}
          onClose={() => setOutlineOpen(false)}
        />
      )}

      <div
        data-view={view}
        className="zekke-page-frame flex flex-col gap-6 py-8 docside:flex-row docside:items-start docside:gap-0 docside:px-4"
      >
        {wide && (
          <OutlinePanel
            editor={editor}
            entries={outlineEntries}
            active={activeHeading}
            expanded={outlineShown}
            onToggle={() => setOutlineShown(!outlineShown)}
          />
        )}
        <div
          className={`flex min-w-0 flex-1 flex-col ${view === 'pages' ? '' : 'px-4 docside:px-0'}`}
          style={{ '--page-scale': pageScale.scale } as CSSProperties}
        >
          {!wide && (
            <div
              className={`zekke-outline-float flex justify-center-safe ${rulers ? 'mb-2' : 'mb-3'}`}
              data-rulers={rulers ? '' : undefined}
            >
              <div className={view === 'pages' ? 'w-[min(210mm,100%)] pl-2' : 'w-full'}>
                <OutlineButton onClick={() => setOutlineOpen(true)} />
              </div>
            </div>
          )}
          {rulers && (
            <HorizontalRuler
              stack={stack}
              scroller={scroller}
              margins={margins}
              scale={pageScale.scale}
              onPreview={setPreviewMargins}
              onCommit={commitMargins}
              onCancel={cancelMargins}
              measurement={regional.measurement}
            />
          )}
          <div ref={scroller} className="zekke-page-scroller flex justify-center-safe">
            <div
              className={`zekke-page-scale relative ${
                view === 'pages' ? 'flex-none' : 'flex w-full justify-center'
              }`}
              data-view={view}
              data-scaled={scaled ? '' : undefined}
              style={
                view === 'pages'
                  ? ({
                      '--page-box-width': `calc(var(--page-width) * ${pageScale.scale})`,
                      width: 'var(--page-box-width)',
                      height: pageScale.height,
                    } as CSSProperties)
                  : undefined
              }
            >
              {rulers && (
                <VerticalRulers
                  pages={pages ?? 1}
                  margins={margins}
                  scale={pageScale.scale}
                  onPreview={setPreviewMargins}
                  onCommit={commitMargins}
                  onCancel={cancelMargins}
                  measurement={regional.measurement}
                />
              )}
              <div
                ref={stack}
                className="zekke-page-stack"
                data-view={view}
                data-rulers={rulers ? '' : undefined}
                style={
                  {
                    '--page-count': pages ?? 1,
                    ...pageMarginVariables(margins),
                    fontFamily: baseFont,
                    transform: scaled ? `scale(${pageScale.scale})` : undefined,
                  } as CSSProperties
                }
              >
                <div aria-hidden="true" className="zekke-page-sheets">
                  {Array.from({ length: view === 'pages' ? (pages ?? 1) : 0 }, (_, page) => (
                    <div key={page} className="zekke-sheet" />
                  ))}
                </div>
                <div className="zekke-page">
                  <EditorContent editor={editor} className="zekke-page-body" />
                </div>
              </div>
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

function useOutlineShown(): [boolean, (shown: boolean) => void] {
  const [shown, setShown] = useState(() => readOutlineShown());

  const choose = useCallback((next: boolean) => {
    setShown(next);
    writeOutlineShown(next);
  }, []);

  return [shown, choose];
}

function useRulersShown(): [boolean, (shown: boolean) => void] {
  const [shown, setShown] = useState(() => readRulersShown());

  const choose = useCallback((next: boolean) => {
    setShown(next);
    writeRulersShown(next);
  }, []);

  return [shown, choose];
}

function useDocumentPageMargins(doc: YDoc): PageMargins {
  const [margins, setMargins] = useState(() => pageMargins(readPageMargins(doc)));

  useEffect(() => {
    const meta = doc.getMap(META_MAP);
    const observer = () =>
      setMargins((previous) => {
        const next = pageMargins(readPageMargins(doc));
        return sameMargins(previous, next) ? previous : next;
      });

    observer();
    meta.observe(observer);
    return () => meta.unobserve(observer);
  }, [doc]);

  return margins;
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
