'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  documentHref,
  saveStatusLabel,
  snapshotCapacityMessage,
  UNTITLED_SPREADSHEET,
} from '@/lib/app';
import type { SyncState } from '@/lib/documents';
import { SPREADSHEET_SYNC_OPTIONS, isSpreadsheet, newSpreadsheetDoc } from '@/lib/spreadsheets';
import * as Y from 'yjs';
import type { Doc as YDoc } from 'yjs';
import { Notice, Spinner } from '@/components/ui';
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

  return <SpreadsheetSurface id={id} doc={sync.doc} state={state} />;
}

function MovedTo({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(href);
  }, [router, href]);

  return null;
}

function SpreadsheetSurface({ id, doc, state }: { id: string; doc: YDoc; state: SyncState }) {
  const capacity = snapshotCapacityMessage(state.capacity);

  return (
    <main className="flex h-[calc(100dvh-var(--staging-banner-h))] flex-col bg-ground">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="flex items-center gap-3 px-3 pt-2.5">
          <Link href="/" aria-label="Back to your vault" className="shrink-0">
            <Image src="/zekke-logo.png" alt="Zekke" width={28} height={28} priority />
          </Link>
          <div className="min-w-0 flex-1">
            <TitleInput doc={doc} label="Spreadsheet title" placeholder={UNTITLED_SPREADSHEET} />
            <SaveStatus
              label={saveStatusLabel(state.status, state.pending)}
              gapDetected={state.gapDetected}
              gapMessage="Some updates are missing — this spreadsheet will not be compacted"
            />
          </div>
        </div>
        {capacity !== undefined && (
          <div className="px-3 pt-2">
            <Notice tone={state.capacity === 'over' ? 'danger' : 'warning'}>{capacity}</Notice>
          </div>
        )}
      </header>
      <SpreadsheetEditor doc={doc} unitId={id} />
    </main>
  );
}
