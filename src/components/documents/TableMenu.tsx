'use client';

import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { PRIVATE_TEXT_PROPS } from '@/lib/app';
import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  TABLE_PICKER_COLUMNS,
  TABLE_PICKER_ROWS,
  clampTableSize,
} from '@/lib/document-tables';
import { useToolMenu } from './useToolMenu';

export function TableMenu({ editor }: { editor: Editor }) {
  const { open, close, toggle, containerProps } = useToolMenu();

  return (
    <div {...containerProps} className="relative">
      <button
        type="button"
        aria-label="Insert table"
        title="Insert table"
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
        className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 ${
          open ? 'bg-raised text-ink' : 'text-ink-soft hover:bg-raised hover:text-ink'
        }`}
      >
        <TableGlyph />
      </button>

      {open && (
        <div
          data-popover
          role="dialog"
          aria-label="Insert table"
          className="absolute left-0 top-full z-30 mt-1 max-h-[min(75vh,32rem)] w-60 overflow-y-auto rounded-xl border border-line bg-surface p-3 shadow-lift"
        >
          <InsertTable editor={editor} onDone={close} />
        </div>
      )}
    </div>
  );
}

function InsertTable({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [hover, setHover] = useState<{ rows: number; columns: number }>();
  const [rows, setRows] = useState('3');
  const [columns, setColumns] = useState('3');
  const [header, setHeader] = useState(true);

  const insert = (rowCount: number, columnCount: number) => {
    editor
      .chain()
      .focus()
      .insertTable({
        rows: clampTableSize(rowCount, MAX_TABLE_ROWS),
        cols: clampTableSize(columnCount, MAX_TABLE_COLUMNS),
        withHeaderRow: header,
      })
      .run();
    onDone();
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-caption normal-case tracking-normal text-ink-muted">
          {hover === undefined ? 'Pick a size' : `${hover.rows} × ${hover.columns}`}
        </p>
        <div
          className="grid w-max gap-0.5"
          style={{ gridTemplateColumns: `repeat(${TABLE_PICKER_COLUMNS}, 1.125rem)` }}
          onPointerLeave={() => setHover(undefined)}
        >
          {Array.from({ length: TABLE_PICKER_ROWS }, (_, row) =>
            Array.from({ length: TABLE_PICKER_COLUMNS }, (_, column) => {
              const lit = hover !== undefined && row < hover.rows && column < hover.columns;
              return (
                <button
                  key={`${row}:${column}`}
                  type="button"
                  aria-label={`${row + 1} × ${column + 1} table`}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerEnter={() => setHover({ rows: row + 1, columns: column + 1 })}
                  onFocus={() => setHover({ rows: row + 1, columns: column + 1 })}
                  onClick={() => insert(row + 1, column + 1)}
                  className={`h-[1.125rem] w-[1.125rem] rounded-sm border transition-colors ${
                    lit ? 'border-brand-500 bg-brand-100' : 'border-line-strong bg-surface'
                  }`}
                />
              );
            }),
          )}
        </div>
      </div>

      <div className="border-t border-line pt-3">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Rows" value={rows} onChange={setRows} />
          <NumberField label="Columns" value={columns} onChange={setColumns} />
        </div>

        <label className="mt-2.5 flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={header} onChange={(event) => setHeader(event.target.checked)} />
          Header row
        </label>

        <button
          type="button"
          onClick={() => insert(Number(rows), Number(columns))}
          className="mt-3 h-8 w-full rounded-md bg-brand-600 text-sm text-white transition-colors hover:bg-brand-700"
        >
          Insert table
        </button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-caption normal-case tracking-normal text-ink-muted">
      {label}
      <input
        {...PRIVATE_TEXT_PROPS}
        type="number"
        inputMode="numeric"
        min={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-0.5 h-8 w-full rounded-md border border-line bg-transparent px-2 text-sm text-ink focus-visible:border-brand-500 focus-visible:outline-none"
      />
    </label>
  );
}

function TableGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.4"
      fill="none"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M3 8h14M8 8v8M13 8v8" />
    </svg>
  );
}
