'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import {
  createDocument,
  createDocumentFromSnapshot,
  deleteDocuments,
  listDocumentsMeta,
  loadDocumentSummaries,
  type DocumentSummary,
} from '@/lib/documents';
import { ApiError } from '@/lib/api';
import { descendantsOf, moveItemsToFolder } from '@/lib/folders';
import { createSpreadsheet } from '@/lib/spreadsheets/api';
import { IMPORT_ACCEPT, importSpreadsheet, titleFromFileName } from '@/lib/spreadsheets/interchange';
import {
  DOCUMENT_MINIATURE_TEXT_SHARE,
  NEW_ITEM_LABELS,
  SPREADSHEET_FILE_LABELS,
  UNREADABLE_IMPORT,
  importErrorMessage,
  importedMessage,
  documentTypeLabel,
  LISTING_EMPTY_CELL,
  buildDocumentTiles,
  defaultIconSize,
  documentCountLabel,
  DOCUMENT_NOUNS,
  countOf,
  deleteActionLabel,
  documentDeleteConfirmation,
  documentHref,
  documentMiniatureTitlePixels,
  documentStatusLabel,
  folderItemsLabel,
  formatBytes,
  gridTemplate,
  iconScale,
  listingDateLabel,
  newestCreatedFirst,
  pagePixels,
  miniatureTextPixels,
  readIconSize,
  readItemLayout,
  retainSelectable,
  UNTITLED_DOCUMENT,
  UNTITLED_SPREADSHEET,
  toggleNoteSelection,
  writeIconSize,
  writeItemLayout,
  type DocumentTile,
  type IconSize,
  type ItemLayout,
} from '@/lib/app';
import { openWithSessionHandoff } from '@/lib/session/handoff';
import { useAuthedContext, useZekke } from '@/components/session/ZekkeProvider';
import { DocumentsIcon, FileTypeIcon, SharingIcon, TrashIcon, UploadIcon } from '@/components/ui/icons';
import {
  Button,
  Card,
  Empty,
  FloatingAddMenu,
  LayoutToggle,
  Notice,
  SizeStepper,
  Spinner,
} from '@/components/ui';
import { Listing, ListingRow, PageTile, TileAction, useMarqueeSelection } from '@/components/tiles';
import ShareItemDialog from '@/components/sharing/ShareItemDialog';
import { startItemDrag } from '@/components/folders/FolderTabs';
import {
  FolderPath,
  FolderRow,
  FolderTile,
  MoveToFolder,
  useFolderTree,
} from '@/components/folders/FolderBrowser';
import { FolderDetailsPanel } from '@/components/folders/FolderDetailsPanel';
import { PanelFacts } from '@/components/shell/SidePanel';
import DocumentMiniature from './DocumentMiniature';

export default function DocumentsScreen() {
  const context = useAuthedContext();
  const { reportError, fullDevice, account } = useZekke();
  const retentionDays = account?.retention_days ?? 0;

  const [summaries, setSummaries] = useState<DocumentSummary[]>();
  const [message, setMessage] = useState<string>();
  const [imported, setImported] = useState<string>();
  const importPicker = useRef<HTMLInputElement>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [pageSize, setPageSize] = useState<IconSize>(defaultIconSize('documents'));
  const [layout, setLayout] = useState<ItemLayout>('grid');
  const [detailedFolder, setDetailedFolder] = useState<string>();
  const [folderCount, setFolderCount] = useState<{ id: string; items: number } | { id: string; error: string }>();
  const closeDetails = useCallback(() => setDetailedFolder(undefined), []);

  useEffect(() => {
    setPageSize(readIconSize('documents'));
    setLayout(readItemLayout('documents'));
  }, []);

  const resize = useCallback((next: IconSize) => {
    setPageSize(next);
    writeIconSize('documents', next);
  }, []);

  const relayout = useCallback((next: ItemLayout) => {
    setLayout(next);
    writeItemLayout('documents', next);
  }, []);

  const reloadDocuments = useRef<() => void>(() => undefined);
  const itemsChanged = useCallback(() => reloadDocuments.current(), []);
  const tree = useFolderTree('documents', itemsChanged);
  const listing = tree.listing;
  const openFolder = tree.current;
  const treeFolders = tree.folders;

  useEffect(() => {
    if (detailedFolder === undefined || treeFolders === undefined) {
      return;
    }
    let live = true;
    setFolderCount(undefined);
    void (async () => {
      try {
        const inside = descendantsOf(treeFolders, detailedFolder);
        const metas = await listDocumentsMeta(context);
        const items = metas.filter((meta) => meta.folder_id !== undefined && inside.has(meta.folder_id)).length;
        if (live) {
          setFolderCount({ id: detailedFolder, items });
        }
      } catch (error) {
        if (live) {
          setFolderCount({ id: detailedFolder, error: reportError(error) });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [context, reportError, detailedFolder, treeFolders]);

  const load = useCallback(async () => {
    if (listing === undefined) {
      return;
    }
    try {
      const metas = await listDocumentsMeta(context, {
        folder: listing === '' ? undefined : listing,
      });
      const loaded = await loadDocumentSummaries(context, metas);

      setSummaries(loaded);
      setMessage(undefined);
      setSelected((current) =>
        retainSelectable(
          current,
          loaded.map((entry) => entry.id),
        ),
      );
    } catch (error) {
      setMessage(reportError(error));
      setSummaries([]);
    }
  }, [context, reportError, listing]);

  useEffect(() => {
    reloadDocuments.current = () => void load();
  }, [load]);

  useEffect(() => {
    setSelecting(false);
    setSelected([]);
    setConfirming(false);
    void load();
  }, [load]);

  const sameIds = useCallback((ids: string[]) => ids, []);

  const selectBox = useCallback((ids: string[]) => {
    setSelected(ids);
    if (ids.length > 0) {
      setSelecting(true);
    }
  }, []);

  const toggleOne = useCallback((id: string) => {
    setSelecting(true);
    setSelected((current) => toggleNoteSelection(current, id));
  }, []);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelected([]);
    setConfirming(false);
  }, []);

  const marquee = useMarqueeSelection({ selected, onSelect: selectBox, onToggle: toggleOne, onExit: exitSelection });

  const dragDocuments = (event: DragEvent, id: string) => {
    const moving = selected.includes(id) ? selected : [id];
    startItemDrag(event, moving, moving.length > 1 ? countOf(moving.length, DOCUMENT_NOUNS) : undefined);
  };

  const tiles = useMemo(
    () => (summaries === undefined ? undefined : buildDocumentTiles(summaries)),
    [summaries],
  );

  const openInNewTab = useCallback((id: string, kind: DocumentTile['kind']) => {
    openWithSessionHandoff(documentHref(id, kind));
  }, []);

  const create = useCallback(async (kind: DocumentTile['kind']) => {
    setBusy(true);
    try {
      const id =
        kind === 'spreadsheet' ? (await createSpreadsheet(context)).id : (await createDocument(context)).document.id;
      if (openFolder !== null) {
        await moveItemsToFolder(context, 'documents', [id], openFolder);
      }
      openInNewTab(id, kind);
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }, [context, load, openFolder, openInNewTab, reportError]);

  const importFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setImported(undefined);
      setMessage(undefined);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await importSpreadsheet(file.name, bytes);
        const record = await createDocumentFromSnapshot(context, result.snapshot);
        result.snapshot.fill(0);
        if (openFolder !== null) {
          await moveItemsToFolder(context, 'documents', [record.id], openFolder);
        }
        openInNewTab(record.id, 'spreadsheet');
        setImported(importedMessage(titleFromFileName(file.name), result.sheets, result.report));
        await load();
      } catch (error) {
        setMessage(importErrorMessage(error) ?? (error instanceof ApiError ? reportError(error) : UNREADABLE_IMPORT));
      } finally {
        setBusy(false);
      }
    },
    [context, load, openFolder, openInNewTab, reportError],
  );

  const removeSelected = useCallback(async () => {
    setBusy(true);
    try {
      await deleteDocuments(context, selected);
      setSelecting(false);
      setSelected([]);
      setConfirming(false);
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }, [context, load, reportError, selected]);

  function activate(id: string) {
    if (selecting) {
      setSelected((current) => toggleNoteSelection(current, id));
      return;
    }
    openInNewTab(id, tiles?.find((tile) => tile.id === id)?.kind ?? 'document');
  }

  const path = (
    <FolderPath
      state={tree}
      rootLabel="Documents"
      rootIcon={<DocumentsIcon className="h-4 w-4 shrink-0" />}
      itemIdsFor={sameIds}
      onDetails={(id) => setDetailedFolder((current) => (current === id ? undefined : id))}
    />
  );

  if (tiles === undefined) {
    return (
      <div className="space-y-5">
        {path}
        <Spinner />
      </div>
    );
  }

  const folderTiles = tree.invalid ? [] : tree.children;
  const detailedFolderRecord =
    detailedFolder === undefined ? undefined : treeFolders?.find((folder) => folder.id === detailedFolder);
  const countShown = folderCount?.id === detailedFolder ? folderCount : undefined;
  const subfolderCount =
    detailedFolderRecord === undefined ? 0 : descendantsOf(treeFolders ?? [], detailedFolderRecord.id).size - 1;

  return (
    <div className="flex-1 space-y-5" {...marquee.containerProps}>
      {path}

      {message !== undefined && (
        <Notice tone="danger" onDismiss={() => setMessage(undefined)}>
          {message}
        </Notice>
      )}

      {imported !== undefined && (
        <Notice tone="info" onDismiss={() => setImported(undefined)}>
          {imported}
        </Notice>
      )}

      <input
        ref={importPicker}
        type="file"
        accept={IMPORT_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file !== undefined) {
            void importFile(file);
          }
        }}
      />

      {sharing ? (
        <ShareItemDialog
          itemType="document"
          itemId={sharing}
          onClose={() => setSharing(undefined)}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-compact text-ink-muted">
          {tiles.length > 0
            ? documentCountLabel(tiles.length)
            : openFolder === null
              ? 'No documents yet'
              : 'No documents in this folder'}
          {selecting && selected.length > 0 && ` · ${selected.length} selected`}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {layout === 'grid' && tiles.length + folderTiles.length > 0 && (
            <SizeStepper
              size={pageSize}
              onChange={resize}
              groupLabel="Document size"
              smallerLabel="Smaller documents"
              largerLabel="Larger documents"
            />
          )}
          {tiles.length + folderTiles.length > 0 && <LayoutToggle layout={layout} onChange={relayout} />}
          {tiles.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => {
                setSelecting((current) => !current);
                setSelected([]);
                setConfirming(false);
              }}
            >
              {selecting ? 'Cancel' : 'Select'}
            </Button>
          )}

          {selecting && <MoveToFolder state={tree} itemIds={selected} rootLabel="Documents" />}

          {fullDevice && selecting && selected.length > 0 && (
            <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
              <TrashIcon className="h-4 w-4" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {confirming && (
        <Notice tone="warning">
          <p>{documentDeleteConfirmation(selected.length, retentionDays)}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" disabled={busy} onClick={() => void removeSelected()}>
              {deleteActionLabel(retentionDays)}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Keep them
            </Button>
          </div>
        </Notice>
      )}

      {tiles.length === 0 && folderTiles.length === 0 ? (
        <Card>
          <Empty icon={<DocumentsIcon className="h-6 w-6" />}>
            {openFolder === null
              ? 'Long-form writing and spreadsheets, encrypted on this device before they are stored. Each opens in its own tab.'
              : 'This folder is empty. Drag documents onto it, or create one while it is open.'}
          </Empty>
        </Card>
      ) : layout === 'list' ? (
        <Listing>
          {newestCreatedFirst(folderTiles).map((folder) => (
            <FolderRow
              key={folder.id}
              state={tree}
              folder={folder}
              nouns={DOCUMENT_NOUNS}
              itemIdsFor={sameIds}
              onDetails={() => setDetailedFolder((current) => (current === folder.id ? undefined : folder.id))}
            />
          ))}
          {newestCreatedFirst(tiles).map((tile) => (
            <DocumentRow
              key={tile.id}
              tile={tile}
              selecting={selecting}
              selected={selected.includes(tile.id)}
              busy={busy}
              onOpen={() => activate(tile.id)}
              onDragStart={(event) => dragDocuments(event, tile.id)}
              onShare={() => setSharing(tile.id)}
              onToggle={() => {
                setSelecting(true);
                setSelected((current) => toggleNoteSelection(current, tile.id));
              }}
            />
          ))}
        </Listing>
      ) : (
        <ul
          className="grid gap-1"
          style={{ gridTemplateColumns: gridTemplate('documents', pageSize) }}
        >
          {folderTiles.map((folder) => (
            <FolderTile
              key={folder.id}
              state={tree}
              folder={folder}
              nouns={DOCUMENT_NOUNS}
              glyphPixels={pagePixels('documents', pageSize)}
              labelClass={iconScale(pageSize).labelClass}
              itemIdsFor={sameIds}
              onDetails={() => setDetailedFolder((current) => (current === folder.id ? undefined : folder.id))}
            />
          ))}
          {tiles.map((tile) => (
            <DocumentFile
              key={tile.id}
              tile={tile}
              textPixels={miniatureTextPixels('documents', pageSize, DOCUMENT_MINIATURE_TEXT_SHARE)}
              titlePixels={documentMiniatureTitlePixels(pageSize)}
              pageWidth={pagePixels('documents', pageSize)}
              labelClass={iconScale(pageSize).labelClass}
              selecting={selecting}
              selected={selected.includes(tile.id)}
              busy={busy}
              onOpen={() => activate(tile.id)}
              onDragStart={(event) => dragDocuments(event, tile.id)}
              onShare={() => setSharing(tile.id)}
              onToggle={() => {
                setSelecting(true);
                setSelected((current) => toggleNoteSelection(current, tile.id));
              }}
            />
          ))}
        </ul>
      )}

      {marquee.overlay}

      {detailedFolderRecord !== undefined ? (
        <FolderDetailsPanel state={tree} folder={detailedFolderRecord} onClose={closeDetails}>
          {countShown === undefined ? (
            <Spinner />
          ) : 'error' in countShown ? (
            <Notice tone="danger">{countShown.error}</Notice>
          ) : (
            <PanelFacts
              facts={[
                {
                  label: 'Items',
                  value: folderItemsLabel({ items: countShown.items, folders: subfolderCount }, DOCUMENT_NOUNS),
                },
              ]}
            />
          )}
        </FolderDetailsPanel>
      ) : null}

      {selecting ? null : (
        <FloatingAddMenu
          label={NEW_ITEM_LABELS.menu}
          spread
          disabled={busy}
          options={[
            {
              label: NEW_ITEM_LABELS.document,
              icon: <FileTypeIcon kind="document" className="h-5 w-5 shrink-0" />,
              onSelect: () => void create('document'),
            },
            {
              label: NEW_ITEM_LABELS.spreadsheet,
              icon: <FileTypeIcon kind="sheet" className="h-5 w-5 shrink-0" />,
              onSelect: () => void create('spreadsheet'),
            },
            {
              label: SPREADSHEET_FILE_LABELS.import,
              icon: <UploadIcon className="h-5 w-5 shrink-0 text-ink-muted" />,
              onSelect: () => importPicker.current?.click(),
            },
          ]}
        />
      )}
    </div>
  );
}

function DocumentFile({
  tile,
  textPixels,
  titlePixels,
  selecting,
  selected,
  busy,
  onOpen,
  onShare,
  onToggle,
  onDragStart,
  pageWidth,
  labelClass,
}: {
  tile: DocumentTile;
  textPixels: number;
  titlePixels: number;
  pageWidth: number;
  labelClass: string;
  selecting: boolean;
  selected: boolean;
  busy: boolean;
  onOpen: () => void;
  onShare: () => void;
  onToggle: () => void;
  onDragStart: (event: DragEvent) => void;
}) {
  return (
    <PageTile
      title={tile.title}
      hint={tile.readable ? tile.edited : (tile.failure ?? 'Could not be decrypted here')}
      aspectClass="aspect-[210/297]"
      readable={tile.readable}
      unreadableIcon={DocumentsIcon}
      selecting={selecting}
      selected={selected}
      busy={busy}
      onOpen={onOpen}
      onShare={onShare}
      onToggle={onToggle}
      onDragStart={onDragStart}
      pageWidth={pageWidth}
      selectId={tile.id}
      labelClass={labelClass}
    >
      {tile.kind === 'spreadsheet' ? (
        <SheetMiniature tile={tile} textPixels={textPixels} titlePixels={titlePixels} />
      ) : tile.firstPage !== undefined ? (
        <DocumentMiniature documentId={tile.id} page={tile.firstPage} />
      ) : (
      <span className="block px-[12%] py-[8.5%]">
        {tile.title !== UNTITLED_DOCUMENT && (
          <span
            style={{ fontSize: `${titlePixels}px` }}
            className="mb-1 block truncate font-semibold leading-tight text-ink"
          >
            {tile.title}
          </span>
        )}
        <span
          style={{ fontSize: `${textPixels}px` }}
          className="block whitespace-pre-wrap break-words leading-[1.5] text-ink-soft"
        >
          {tile.thumbnail}
        </span>
      </span>
      )}
    </PageTile>
  );
}

function DocumentRow({
  tile,
  selecting,
  selected,
  busy,
  onOpen,
  onShare,
  onToggle,
  onDragStart,
}: {
  tile: DocumentTile;
  selecting: boolean;
  selected: boolean;
  busy: boolean;
  onOpen: () => void;
  onShare: () => void;
  onToggle: () => void;
  onDragStart: (event: DragEvent) => void;
}) {
  return (
    <ListingRow
      icon={<FileTypeIcon kind={tile.kind === 'spreadsheet' ? 'sheet' : 'document'} />}
      name={tile.title}
      nameClassName={tile.readable ? 'text-ink' : 'italic text-ink-muted'}
      type={documentTypeLabel(tile.kind)}
      size={tile.bytes === undefined ? LISTING_EMPTY_CELL : formatBytes(tile.bytes)}
      modified={listingDateLabel(tile.updatedAt)}
      status={documentStatusLabel(tile.readable)}
      statusClassName={tile.readable ? 'text-ink-muted' : 'text-danger'}
      title={tile.readable ? tile.edited : (tile.failure ?? 'Could not be decrypted here')}
      openLabel={selecting ? `${selected ? 'Deselect' : 'Select'} ${tile.title}` : tile.title}
      disabled={busy}
      onOpen={onOpen}
      selection={{ selecting, selected, disabled: busy, onToggle }}
      selectId={tile.id}
      highlighted={selected}
      draggable={!busy}
      onDragStart={onDragStart}
      actions={
        selecting ? undefined : (
          <TileAction label={`Share ${tile.title}`} disabled={busy || !tile.readable} onClick={onShare}>
            <SharingIcon className="h-3 w-3 shrink-0" />
          </TileAction>
        )
      }
    />
  );
}

function SheetMiniature({
  tile,
  textPixels,
  titlePixels,
}: {
  tile: DocumentTile;
  textPixels: number;
  titlePixels: number;
}) {
  const grid = tile.grid ?? [];
  const columns = Math.max(3, ...grid.map((row) => row.length));
  const rows = Math.max(8, grid.length);

  return (
    <span className="block px-[8%] py-[8.5%]">
      {tile.title !== UNTITLED_SPREADSHEET && (
        <span
          style={{ fontSize: `${titlePixels}px` }}
          className="mb-1 block truncate font-semibold leading-tight text-ink"
        >
          {tile.title}
        </span>
      )}
      <span
        aria-hidden="true"
        style={{ fontSize: `${textPixels}px`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        className="grid border-l border-t border-line"
      >
        {Array.from({ length: rows * columns }, (_, index) => {
          const text = grid[Math.floor(index / columns)]?.[index % columns] ?? '';
          return (
            <span key={index} className="truncate border-b border-r border-line px-[2px] leading-[1.6] text-ink-soft">
              {text === '' ? ' ' : text}
            </span>
          );
        })}
      </span>
    </span>
  );
}
