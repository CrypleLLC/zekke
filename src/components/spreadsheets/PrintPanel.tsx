'use client';

import type { ReactNode } from 'react';
import {
  MARGIN_LABELS,
  ORDER_LABELS,
  ORIENTATION_LABELS,
  PAPER_LABELS,
  PRINT_LABELS,
  SCALE_LABELS,
  columnBreakLabel,
  columnsLabel,
  pageCountLabel,
  rowBreakLabel,
  rowsLabel,
} from '@/lib/app';
import type { PageOrientation, PaperSize } from '@/lib/document-page';
import {
  MARGIN_PRESETS,
  PAGE_ORDERS,
  PRINT_SCALES,
  addPageBreak,
  clearPageBreaks,
  rangeLabel,
  removePageBreak,
  writePageSetup,
  writePrintArea,
  writePrintTitles,
  type GridRange,
  type MarginPreset,
  type PageOrder,
  type PageSetup,
  type PrintScale,
  type SheetMap,
} from '@/lib/spreadsheets';
import { Button, IconButton, Select } from '@/components/ui';
import { CloseIcon, PrintIcon } from '@/components/ui/icons';
import type { PrintModel } from './SheetPrint';

function choices<T extends string>(values: readonly T[], labels: Record<T, string>) {
  return values.map((value) => ({ value, label: labels[value] }));
}

const PAPER_CHOICES = choices<PaperSize>(['a4', 'letter'], PAPER_LABELS);
const ORIENTATION_CHOICES = choices<PageOrientation>(['portrait', 'landscape'], ORIENTATION_LABELS);
const SCALE_CHOICES = choices<PrintScale>(PRINT_SCALES, SCALE_LABELS);
const MARGIN_CHOICES = choices<MarginPreset>(MARGIN_PRESETS, MARGIN_LABELS);
const ORDER_CHOICES = choices<PageOrder>(PAGE_ORDERS, ORDER_LABELS);

export default function PrintPanel({
  model,
  selection,
  onEdit,
  onPrint,
  onClose,
}: {
  model: PrintModel;
  selection: GridRange | undefined;
  onEdit: (change: (sheet: SheetMap) => void) => void;
  onPrint: () => void;
  onClose: () => void;
}) {
  const { setup, settings, layout } = model;
  const pages = layout?.pages.length ?? 0;
  const update = (patch: Partial<PageSetup>) => onEdit((sheet) => writePageSetup(sheet, { ...setup, ...patch }));
  const selectedRows = selection === undefined ? undefined : { start: selection.startRow, end: selection.endRow };
  const selectedColumns = selection === undefined ? undefined : { start: selection.startColumn, end: selection.endColumn };
  const hasBreaks = settings.rowBreaks.length > 0 || settings.columnBreaks.length > 0;

  return (
    <aside
      aria-label={PRINT_LABELS.panel}
      className="zekke-no-print flex w-80 shrink-0 flex-col border-l border-line bg-surface"
    >
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="text-headline text-ink">{PRINT_LABELS.panel}</h2>
        <IconButton autoFocus label={PRINT_LABELS.close} onClick={onClose}>
          <CloseIcon className="h-4 w-4 shrink-0" />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <p className="text-sm text-ink-muted">
          {PRINT_LABELS.selected}{' '}
          <span className="font-mono text-ink">{selection === undefined ? PRINT_LABELS.none : rangeLabel(selection)}</span>
        </p>
        <Select
          label={PRINT_LABELS.paper}
          choices={PAPER_CHOICES}
          value={setup.paper}
          onChange={(event) => update({ paper: event.target.value === 'letter' ? 'letter' : 'a4' })}
        />
        <Select
          label={PRINT_LABELS.orientation}
          choices={ORIENTATION_CHOICES}
          value={setup.orientation}
          onChange={(event) => update({ orientation: event.target.value === 'landscape' ? 'landscape' : 'portrait' })}
        />
        <Select
          label={PRINT_LABELS.scale}
          choices={SCALE_CHOICES}
          value={setup.scale}
          onChange={(event) => update({ scale: pick(event.target.value, PRINT_SCALES, setup.scale) })}
        />
        <Select
          label={PRINT_LABELS.margins}
          choices={MARGIN_CHOICES}
          value={setup.margins}
          onChange={(event) => update({ margins: pick(event.target.value, MARGIN_PRESETS, setup.margins) })}
        />
        <Select
          label={PRINT_LABELS.order}
          choices={ORDER_CHOICES}
          value={setup.order}
          onChange={(event) => update({ order: pick(event.target.value, PAGE_ORDERS, setup.order) })}
        />
        <label className="flex items-start gap-2 text-compact text-ink-soft">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-brand-500"
            checked={setup.gridlines}
            onChange={(event) => update({ gridlines: event.target.checked })}
          />
          <span>{PRINT_LABELS.gridlines}</span>
        </label>

        <Setting
          title={PRINT_LABELS.area}
          value={settings.area === undefined ? PRINT_LABELS.wholeSheet : rangeLabel(settings.area)}
          monospace={settings.area !== undefined}
        >
          <Button
            variant="secondary"
            disabled={selection === undefined}
            onClick={() => selection !== undefined && onEdit((sheet) => writePrintArea(sheet, selection))}
          >
            {PRINT_LABELS.useSelection}
          </Button>
          {settings.area === undefined ? null : (
            <Button variant="ghost" onClick={() => onEdit((sheet) => writePrintArea(sheet, undefined))}>
              {PRINT_LABELS.clear}
            </Button>
          )}
        </Setting>

        <Setting
          title={PRINT_LABELS.titleRows}
          value={settings.titleRows === undefined ? PRINT_LABELS.none : rowsLabel(settings.titleRows)}
        >
          <Button
            variant="secondary"
            disabled={selectedRows === undefined}
            onClick={() => selectedRows !== undefined && onEdit((sheet) => writePrintTitles(sheet, 'rows', selectedRows))}
          >
            {PRINT_LABELS.useSelectedRows}
          </Button>
          {settings.titleRows === undefined ? null : (
            <Button variant="ghost" onClick={() => onEdit((sheet) => writePrintTitles(sheet, 'rows', undefined))}>
              {PRINT_LABELS.clear}
            </Button>
          )}
        </Setting>

        <Setting
          title={PRINT_LABELS.titleColumns}
          value={settings.titleColumns === undefined ? PRINT_LABELS.none : columnsLabel(settings.titleColumns)}
        >
          <Button
            variant="secondary"
            disabled={selectedColumns === undefined}
            onClick={() =>
              selectedColumns !== undefined && onEdit((sheet) => writePrintTitles(sheet, 'columns', selectedColumns))
            }
          >
            {PRINT_LABELS.useSelectedColumns}
          </Button>
          {settings.titleColumns === undefined ? null : (
            <Button variant="ghost" onClick={() => onEdit((sheet) => writePrintTitles(sheet, 'columns', undefined))}>
              {PRINT_LABELS.clear}
            </Button>
          )}
        </Setting>

        <div>
          <p className="text-compact font-semibold text-ink-soft">{PRINT_LABELS.breaks}</p>
          {hasBreaks ? (
            <ul className="mt-1.5 flex flex-col gap-1">
              {settings.rowBreaks.map((row) => (
                <BreakItem key={`r${row}`} label={rowBreakLabel(row)} onRemove={() => onEdit((sheet) => removePageBreak(sheet, 'rows', row))} />
              ))}
              {settings.columnBreaks.map((column) => (
                <BreakItem
                  key={`c${column}`}
                  label={columnBreakLabel(column)}
                  onRemove={() => onEdit((sheet) => removePageBreak(sheet, 'columns', column))}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-sm text-ink-muted">{PRINT_LABELS.noBreaks}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={selection === undefined || selection.startRow === 0}
              onClick={() => selection !== undefined && onEdit((sheet) => void addPageBreak(sheet, 'rows', selection.startRow))}
            >
              {PRINT_LABELS.breakBeforeRow}
            </Button>
            <Button
              variant="secondary"
              disabled={selection === undefined || selection.startColumn === 0}
              onClick={() =>
                selection !== undefined && onEdit((sheet) => void addPageBreak(sheet, 'columns', selection.startColumn))
              }
            >
              {PRINT_LABELS.breakBeforeColumn}
            </Button>
            {hasBreaks ? (
              <Button variant="ghost" onClick={() => onEdit((sheet) => clearPageBreaks(sheet))}>
                {PRINT_LABELS.clearBreaks}
              </Button>
            ) : null}
          </div>
          {hasBreaks && setup.scale !== 'actual' ? <p className="mt-2 text-sm text-ink-muted">{PRINT_LABELS.breaksIgnored}</p> : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-line p-4">
        {layout !== undefined && pages > 0 ? (
          <p className="text-sm text-ink-soft">{pageCountLabel(pages, layout.totalPages, layout.scale)}</p>
        ) : null}
        <Button disabled={pages === 0} onClick={onPrint}>
          <PrintIcon className="h-4 w-4" />
          {PRINT_LABELS.print}
        </Button>
      </div>
    </aside>
  );
}

function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function Setting({
  title,
  value,
  monospace = false,
  children,
}: {
  title: string;
  value: string;
  monospace?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-compact font-semibold text-ink-soft">{title}</p>
      <p className={`mt-1.5 text-sm text-ink ${monospace ? 'font-mono' : ''}`}>{value}</p>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function BreakItem({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li className="flex items-center justify-between gap-2 text-sm text-ink">
      <span>{label}</span>
      <IconButton label={PRINT_LABELS.removeBreak} onClick={onRemove}>
        <CloseIcon className="h-3.5 w-3.5 shrink-0" />
      </IconButton>
    </li>
  );
}
