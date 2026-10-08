'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  REBUILD_LABELS,
  REBUILD_OFFER_MESSAGE,
  REPLACED_MESSAGE,
  documentHref,
  saveStatusLabel,
  snapshotCapacityMessage,
  UNTITLED_SPREADSHEET,
} from '@/lib/app';
import type { DocumentSync, SyncState } from '@/lib/documents';
import {
  META_MAP,
  SPREADSHEET_SYNC_OPTIONS,
  isSpreadsheet,
  newSpreadsheetDoc,
  readReplacedBy,
  shouldOfferRebuild,
} from '@/lib/spreadsheets';
import * as Y from 'yjs';
import type { Doc as YDoc } from 'yjs';
import { Button, Notice, Spinner } from '@/components/ui';
import { useZekke } from '@/components/session/ZekkeProvider';
import { SaveStatus, TitleInput } from '@/components/documents/ItemHeader';
import { useDocumentSync, type DocumentSyncSetup } from '@/components/documents/useDocumentSync';

const SpreadsheetEditor = dynamic(() => import('./SpreadsheetEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center">
      <Spinner />
    </div>
  ),
});

const RebuildDialog = dynamic(() => import('./RebuildDialog'), { ssr: false });

const SPREADSHEET_SETUP: DocumentSyncSetup = {
  syncOptions: SPREADSHEET_SYNC_OPTIONS,
  seedUntouched: (doc) => Y.applyUpdate(doc, Y.encodeStateAsUpdate(newSpreadsheetDoc())),
};

export default function SpreadsheetWorkspace({ id }: { id: string }) {
  const { sync, state, error } = useDocumentSync(id, SPREADSHEET_SETUP);

  if (error !== undefined) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <Notice tone="danger">
          <strong className="font-medium">This spreadsheet could not be opened.</strong> {error}
        </Notice>
        <p className="mt-6 text-sm">
          <Link href="/" className="text-brand-700 hover:underline">
            Back to your vault
          </Link>
        </p>
      </main>
    );
  }

  if (sync === undefined || !isSpreadsheet(sync.doc)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ground">
        {sync !== undefined && <MovedTo href={documentHref(id, 'document')} />}
        <Spinner />
      </main>
    );
  }

  return <SpreadsheetSurface id={id} sync={sync} state={state} />;
}

function MovedTo({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(href);
  }, [router, href]);

  return null;
}

function useReplacedBy(doc: YDoc): string | undefined {
  const [replacedBy, setReplacedBy] = useState(() => readReplacedBy(doc));

  useEffect(() => {
    const meta = doc.getMap(META_MAP);
    const read = () => setReplacedBy(readReplacedBy(doc));
    read();
    meta.observe(read);
    return () => meta.unobserve(read);
  }, [doc]);

  return replacedBy;
}

function SpreadsheetSurface({ id, sync, state }: { id: string; sync: DocumentSync; state: SyncState }) {
  const doc = sync.doc;
  const { fullDevice } = useZekke();
  const capacity = snapshotCapacityMessage(state.capacity);
  const replacedBy = useReplacedBy(doc);
  const [rebuilding, setRebuilding] = useState(false);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const offerRebuild = fullDevice && replacedBy === undefined && shouldOfferRebuild(state);

  return (
    <main className="flex h-[calc(100dvh-var(--staging-banner-h))] flex-col bg-ground">
      <header className="relative z-20 shrink-0 border-b border-line bg-surface">
        <div className="flex items-start gap-3 px-3 py-2">
          <Link href="/" aria-label="Back to your vault" className="mt-1 shrink-0">
            <Image src="/zekke-logo.png" alt="Zekke" width={28} height={28} priority />
          </Link>
          <div className="min-w-0 max-w-md flex-none">
            <TitleInput doc={doc} label="Spreadsheet title" placeholder={UNTITLED_SPREADSHEET} fit />
            <SaveStatus
              label={saveStatusLabel(state.status, state.pending)}
              gapDetected={state.gapDetected}
              gapMessage="Some updates are missing — this spreadsheet will not be compacted"
            />
          </div>
          <div ref={setToolbarSlot} className="flex min-w-0 flex-1 flex-wrap items-center pt-0.5" />
        </div>
        {replacedBy !== undefined && (
          <div className="px-3 pt-2">
            <Notice tone="warning">
              {REPLACED_MESSAGE}{' '}
              <Link href={documentHref(replacedBy, 'spreadsheet')} className="font-semibold text-brand-700 hover:underline">
                {REBUILD_LABELS.openNew}
              </Link>
            </Notice>
          </div>
        )}
        {(capacity !== undefined || offerRebuild) && (
          <div className="px-3 pt-2">
            <Notice tone={state.capacity === 'over' ? 'danger' : 'warning'}>
              {capacity ?? REBUILD_OFFER_MESSAGE}
              {offerRebuild ? (
                <div className="mt-2">
                  <Button variant="secondary" onClick={() => setRebuilding(true)}>
                    {REBUILD_LABELS.offer}
                  </Button>
                </div>
              ) : null}
            </Notice>
          </div>
        )}
      </header>
      {rebuilding ? <RebuildDialog sync={sync} onClose={() => setRebuilding(false)} /> : null}
      <SpreadsheetEditor doc={doc} unitId={id} toolbarSlot={toolbarSlot} />
    </main>
  );
}
