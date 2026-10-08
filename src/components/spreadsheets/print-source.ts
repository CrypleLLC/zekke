import {
  CellValueType,
  IUniverInstanceService,
  UniverInstanceType,
  getDisplayValueFromCell,
  type ICellData,
  type IStyleData,
  type Univer,
  type Workbook,
  type Worksheet,
} from '@univerjs/core';
import { getCustomNumberDisplayText, getFontStyleString, getGeneralNumberDisplayText } from '@univerjs/engine-render';
import type * as Y from 'yjs';
import {
  PrintGrid,
  anchorRect,
  cellLook,
  chartOption,
  contentArea,
  isDecorated,
  lineEnds,
  readCharts,
  readSheet,
  type CellArea,
  type CellLook,
  type ContentRect,
  type PrintCell,
  type ValueKind,
} from '@/lib/spreadsheets';
import { chartSvg, svgDataUrl } from './chart-svg';
import { chartValues } from './chart-view';

export interface SheetPrintCell extends PrintCell {
  look: CellLook;
  font: string;
  generalNumber?: number;
  formattedNumber: boolean;
}

export interface PrintChart {
  id: string;
  rect: ContentRect;
  url: string;
}

export interface SheetPrint {
  sheetId: string;
  grid: PrintGrid;
  merges: CellArea[];
  contentArea: CellArea | undefined;
  charts: PrintChart[];
  cellAt(row: number, column: number): SheetPrintCell | undefined;
}

type InterceptedCell = ICellData & { interceptorStyle?: IStyleData | null };

function valueKind(cell: InterceptedCell | null | undefined): ValueKind {
  if (cell === null || cell === undefined) {
    return 'text';
  }
  if (cell.t === CellValueType.BOOLEAN) {
    return 'boolean';
  }
  if (cell.t === CellValueType.NUMBER || ((cell.t === undefined || cell.t === null) && typeof cell.v === 'number')) {
    return 'number';
  }
  return 'text';
}

function hasContent(cell: ICellData | null | undefined | void): boolean {
  if (cell === null || cell === undefined) {
    return false;
  }
  return (cell.v !== undefined && cell.v !== null && cell.v !== '') || (cell.p !== undefined && cell.p !== null) || Boolean(cell.f);
}

export function printedText(cell: SheetPrintCell, width: number): string {
  const available = width - cell.look.padding.left - cell.look.padding.right;
  if (cell.generalNumber !== undefined) {
    return getGeneralNumberDisplayText(cell.generalNumber, cell.text, cell.font, available);
  }
  if (cell.formattedNumber) {
    return getCustomNumberDisplayText(cell.text, cell.font, available);
  }
  return cell.text;
}

export class SheetPrintReader {
  private readonly instances: IUniverInstanceService;

  constructor(
    univer: Univer,
    private readonly unitId: string,
  ) {
    this.instances = univer.__getInjector().get(IUniverInstanceService);
  }

  private worksheet(sheetId: string): Worksheet | undefined {
    const workbook = this.instances.getUnit<Workbook>(this.unitId, UniverInstanceType.UNIVER_SHEET);
    return workbook?.getSheetBySheetId(sheetId) ?? undefined;
  }

  read(doc: Y.Doc, sheetId: string): SheetPrint | undefined {
    const worksheet = this.worksheet(sheetId);
    const sheet = readSheet(doc, sheetId);
    if (worksheet === undefined || sheet === undefined) {
      return undefined;
    }

    const rowSizes: number[] = [];
    for (let row = 0; row < worksheet.getMaxRows(); row += 1) {
      rowSizes.push(worksheet.getRowVisible(row) ? worksheet.getRowHeight(row) : 0);
    }
    const columnSizes: number[] = [];
    for (let column = 0; column < worksheet.getMaxColumns(); column += 1) {
      columnSizes.push(worksheet.getColVisible(column) ? worksheet.getColumnWidth(column) : 0);
    }
    const grid = new PrintGrid(rowSizes, columnSizes);
    const rows = { origin: 0, ends: lineEnds(rowSizes) };
    const columns = { origin: 0, ends: lineEnds(columnSizes) };

    const merges: CellArea[] = worksheet.getMergeData().map((range) => ({
      startRow: range.startRow,
      endRow: range.endRow,
      startColumn: range.startColumn,
      endColumn: range.endColumn,
    }));

    const cache = new Map<number, SheetPrintCell | null>();
    const cellAt = (row: number, column: number): SheetPrintCell | undefined => {
      const key = row * grid.columnCount + column;
      const cached = cache.get(key);
      if (cached !== undefined) {
        return cached ?? undefined;
      }
      const read = this.cell(worksheet, row, column);
      cache.set(key, read ?? null);
      return read;
    };

    const used: { row: number; column: number }[] = [];
    worksheet.getCellMatrix().forValue((row, column, cell) => {
      if (hasContent(cell) || (cell?.s !== undefined && cell?.s !== null && cellAt(row, column)?.decorated)) {
        used.push({ row, column });
      }
    });

    const stored = readCharts(sheet);
    const charts = stored.map((chart) => {
      const rect = anchorRect(rows, columns, chart.anchor);
      return {
        id: chart.id,
        rect,
        url: svgDataUrl(chartSvg(chartOption(chart.settings, chartValues(worksheet, chart.source)), rect.width, rect.height)),
      };
    });

    const chartExtents = stored.map(({ anchor }) => ({
      startRow: anchor.from.row,
      startColumn: anchor.from.column,
      endRow: anchor.to.row,
      endColumn: anchor.to.column,
    }));

    return {
      sheetId,
      grid,
      merges,
      contentArea: contentArea(used, [...merges.filter((merge) => cellAt(merge.startRow, merge.startColumn) !== undefined), ...chartExtents]),
      charts,
      cellAt,
    };
  }

  private cell(worksheet: Worksheet, row: number, column: number): SheetPrintCell | undefined {
    const cell = worksheet.getCell(row, column) as InterceptedCell | null | undefined;
    const kind = valueKind(cell);
    const style = worksheet.getComposedCellStyleByCellData(row, column, cell) as IStyleData & Record<string, unknown>;
    const interceptorColor = cell?.interceptorStyle?.cl;
    const look = cellLook(interceptorColor ? { ...style, cl: interceptorColor } : style, kind);
    const text = getDisplayValueFromCell(cell ?? null);
    const decorated = isDecorated(look);
    if (text === '' && !decorated) {
      return undefined;
    }
    const printed: SheetPrintCell = {
      text,
      numeric: kind === 'number',
      horizontal: look.horizontal,
      wrap: look.wrap,
      decorated,
      look,
      font: getFontStyleString(style).fontCache,
      formattedNumber: false,
    };
    if (kind === 'number' && text !== '') {
      if (typeof cell?.v === 'number') {
        printed.generalNumber = cell.v;
      } else {
        printed.formattedNumber = true;
      }
    }
    return printed;
  }
}
