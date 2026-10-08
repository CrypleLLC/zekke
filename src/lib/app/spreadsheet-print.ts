import type { PageOrientation, PaperSize } from "@/lib/document-page";
import type { LineSpan, MarginPreset, PageOrder, PrintScale } from "@/lib/spreadsheets/print";
import { columnLetters } from "@/lib/spreadsheets/formulas";

export const PRINT_LABELS = {
  open: "Print",
  openHint: "Print or save as PDF",
  panel: "Print",
  close: "Close the print preview",
  print: "Print or save as PDF",
  paper: "Paper",
  orientation: "Orientation",
  scale: "Scale",
  margins: "Margins",
  order: "Page order",
  gridlines: "Print gridlines",
  area: "Print area",
  wholeSheet: "Everything with content",
  useSelection: "Use the selected cells",
  clear: "Clear",
  titleRows: "Rows repeated on every page",
  titleColumns: "Columns repeated on every page",
  none: "None",
  useSelectedRows: "Use the selected rows",
  useSelectedColumns: "Use the selected columns",
  breaks: "Page breaks",
  noBreaks: "None — pages break where they fill up.",
  breakBeforeRow: "Break before the selected row",
  breakBeforeColumn: "Break before the selected column",
  removeBreak: "Remove this break",
  clearBreaks: "Remove all breaks",
  breaksIgnored: "A fit to the page width ignores column breaks; a fit to one page ignores all of them.",
  nothing: "Nothing to print: this sheet has no content in its print area.",
  preview: "Print preview",
  selected: "Selected in the sheet:",
  page: "Page",
} as const;

export const PAPER_LABELS: Record<PaperSize, string> = {
  a4: "A4 (210 × 297 mm)",
  letter: "Letter (8.5 × 11 in)",
};

export const ORIENTATION_LABELS: Record<PageOrientation, string> = {
  portrait: "Portrait",
  landscape: "Landscape",
};

export const SCALE_LABELS: Record<PrintScale, string> = {
  actual: "Actual size",
  width: "Fit to the page width",
  page: "Fit on one page",
};

export const MARGIN_LABELS: Record<MarginPreset, string> = {
  normal: "Normal",
  narrow: "Narrow",
  wide: "Wide",
};

export const ORDER_LABELS: Record<PageOrder, string> = {
  down: "Down, then over",
  over: "Over, then down",
};

export function rowsLabel(span: LineSpan): string {
  return span.start === span.end ? `Row ${span.start + 1}` : `Rows ${span.start + 1}–${span.end + 1}`;
}

export function columnsLabel(span: LineSpan): string {
  return span.start === span.end
    ? `Column ${columnLetters(span.start)}`
    : `Columns ${columnLetters(span.start)}–${columnLetters(span.end)}`;
}

export function rowBreakLabel(row: number): string {
  return `Before row ${row + 1}`;
}

export function columnBreakLabel(column: number): string {
  return `Before column ${columnLetters(column)}`;
}

export function pageCountLabel(pages: number, total: number, scale: number): string {
  const percent = Math.round(scale * 100);
  const count = pages === 1 ? "1 page" : `${pages} pages`;
  if (total > pages) {
    return `Only the first ${pages} of ${total} pages are shown and printed. Set a print area or fit the sheet to the page width.`;
  }
  return percent === 100 ? count : `${count} at ${percent} %`;
}
