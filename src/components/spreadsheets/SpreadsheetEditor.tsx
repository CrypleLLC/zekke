'use client';

import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';
import '@univerjs/sheets-formula-ui/lib/index.css';
import '@univerjs/sheets-numfmt-ui/lib/index.css';

import { useEffect, useRef, useState } from 'react';
import type { Doc as YDoc } from 'yjs';
import { SPREADSHEET_FILE_LABELS, UNTITLED_SPREADSHEET, capacityRefusalMessage } from '@/lib/app';
import { readTitle } from '@/lib/documents/content';
import { exportDelimited, exportFileName, exportXlsx } from '@/lib/spreadsheets/interchange';
import type { CapacityRefusal } from '@/lib/spreadsheets';
import { Notice } from '@/components/ui';
import { DownloadIcon } from '@/components/ui/icons';
import { UndoIcon } from '@/components/ui/icons';
import { SpreadsheetBinding } from './binding';
import { guardPrivateText } from './private-text';
import { startSpreadsheetUniver } from './univer';

export default function SpreadsheetEditor({ doc, unitId }: { doc: YDoc; unitId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [binding, setBinding] = useState<SpreadsheetBinding>();
  const [refusal, setRefusal] = useState<CapacityRefusal>();
  const [downloadError, setDownloadError] = useState<string>();

  useEffect(() => {
    const element = container.current;
    if (element === null) {
      return;
    }
    const stopGuard = guardPrivateText(document.body);
    const univer = startSpreadsheetUniver(element, doc, unitId);
    const created = new SpreadsheetBinding({ univer, unitId, doc, onCapacityRefused: setRefusal });
    setBinding(created);

    return () => {
      setBinding(undefined);
      created.dispose();
      univer.dispose();
      stopGuard();
    };
  }, [doc, unitId]);

  const history = useHistory(binding);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="toolbar" aria-label="History" className="flex items-center gap-1 px-3 py-1">
        <HistoryButton label="Undo" disabled={!history.canUndo} onClick={() => binding?.undo()}>
          <UndoIcon className="h-4 w-4" />
        </HistoryButton>
        <HistoryButton label="Redo" disabled={!history.canRedo} onClick={() => binding?.redo()}>
          <UndoIcon flipped className="h-4 w-4" />
        </HistoryButton>
        <span className="flex-1" />
        <DownloadMenu doc={doc} binding={binding} onError={setDownloadError} />
      </div>
      {downloadError !== undefined && (
        <div className="px-3 pb-2">
          <Notice tone="danger" onDismiss={() => setDownloadError(undefined)}>
            {downloadError}
          </Notice>
        </div>
      )}
      {refusal !== undefined && (
        <div className="px-3 pb-2">
          <Notice tone="warning" onDismiss={() => setRefusal(undefined)}>
            {capacityRefusalMessage(refusal)}
          </Notice>
        </div>
      )}
      <div ref={container} translate="no" className="zekke-spreadsheet notranslate min-h-0 flex-1" />
    </div>
  );
}

function useHistory(binding: SpreadsheetBinding | undefined): { canUndo: boolean; canRedo: boolean } {
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });

  useEffect(() => {
    if (binding === undefined) {
      setHistory({ canUndo: false, canRedo: false });
      return;
    }
    const manager = binding.undoManager;
    const read = () => setHistory({ canUndo: binding.canUndo(), canRedo: binding.canRedo() });
    read();
    manager.on('stack-item-added', read);
    manager.on('stack-item-popped', read);
    manager.on('stack-cleared', read);
    return () => {
      manager.off('stack-item-added', read);
      manager.off('stack-item-popped', read);
      manager.off('stack-cleared', read);
    };
  }, [binding]);

  return history;
}

function HistoryButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-ink-soft transition hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

const DOWNLOAD_FAILED = 'The download could not be prepared. Nothing left this device.';

function saveFile(bytes: BlobPart, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function DownloadMenu({
  doc,
  binding,
  onError,
}: {
  doc: YDoc;
  binding: SpreadsheetBinding | undefined;
  onError: (message: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function download(format: 'xlsx' | 'csv' | 'tsv') {
    if (binding === undefined) {
      return;
    }
    setOpen(false);
    setBusy(true);
    onError(undefined);
    try {
      const snapshot = binding.workbookSnapshot();
      const name = exportFileName(readTitle(doc), format, UNTITLED_SPREADSHEET);
      if (format === 'xlsx') {
        saveFile(
          (await exportXlsx(snapshot, doc)) as BlobPart,
          name,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
      } else {
        const text = exportDelimited(snapshot, binding.activeSheetId(), format === 'csv' ? ',' : '\t');
        saveFile(`\ufeff${text}`, name, format === 'csv' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8');
      }
    } catch {
      onError(DOWNLOAD_FAILED);
    } finally {
      setBusy(false);
    }
  }

  const options: { format: 'xlsx' | 'csv' | 'tsv'; label: string }[] = [
    { format: 'xlsx', label: SPREADSHEET_FILE_LABELS.xlsx },
    { format: 'csv', label: SPREADSHEET_FILE_LABELS.csv },
    { format: 'tsv', label: SPREADSHEET_FILE_LABELS.tsv },
  ];

  return (
    <div ref={holder} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={binding === undefined || busy}
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-compact font-semibold text-ink-soft transition hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <DownloadIcon className="h-4 w-4" />
        {SPREADSHEET_FILE_LABELS.download}
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          {options.map((option, index) => (
            <button
              key={option.format}
              type="button"
              role="menuitem"
              onClick={() => void download(option.format)}
              className={`flex w-full cursor-pointer px-3 py-2.5 text-left text-compact font-semibold text-ink-soft transition-colors hover:bg-raised hover:text-ink ${
                index > 0 ? 'border-t border-line' : ''
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
