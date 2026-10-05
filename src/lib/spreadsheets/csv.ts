import type { ICellData, IWorkbookData, IWorksheetData, LocaleType } from '@univerjs/core';
import { CELL_BOOLEAN, CELL_FORCE_STRING, CELL_NUMBER, CELL_STRING } from './cells';
import { ELEMENT_ID_LENGTH, SHEET_ID_LENGTH, randomId } from './ids';
import { DEFAULT_COLUMN_COUNT, DEFAULT_ROW_COUNT } from './sheets';

export type Delimiter = ',' | ';' | '\t';

export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t'];
const BYTE_ORDER_MARK = '﻿';
const CANONICAL_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const INJECTION_LEADERS = ['=', '+', '-', '@', '\t', '\r'];

export function detectDelimiter(text: string): Delimiter {
  const firstLine = firstRecord(text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text);
  let best: Delimiter = ',';
  let bestCount = -1;
  for (const delimiter of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (const character of firstLine) {
      if (character === '"') {
        quoted = !quoted;
      } else if (!quoted && character === delimiter) {
        count += 1;
      }
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

function firstRecord(text: string): string {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && (character === '\n' || character === '\r')) {
      return text.slice(0, index);
    }
  }
  return text;
}

export function parseDelimited(input: string, delimiter: Delimiter = detectDelimiter(input)): string[][] {
  const text = input.startsWith(BYTE_ORDER_MARK) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;

  const endField = () => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
      continue;
    }
    if (character === delimiter) {
      endField();
      continue;
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      endRow();
      continue;
    }
    field += character;
    fieldStarted = true;
  }
  if (fieldStarted || field.length > 0 || row.length > 0) {
    endRow();
  }
  return rows;
}

export function delimitedCell(text: string): ICellData | undefined {
  if (text === '') {
    return undefined;
  }
  if (CANONICAL_NUMBER.test(text)) {
    return { v: Number(text), t: CELL_NUMBER };
  }
  const upper = text.toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') {
    return { v: upper === 'TRUE', t: CELL_BOOLEAN };
  }
  if (/^\d/.test(text) && /^[\d.,eE+-]+$/.test(text)) {
    return { v: text, t: CELL_FORCE_STRING };
  }
  if (INJECTION_LEADERS.some((leader) => text.startsWith(leader))) {
    return { v: text, t: CELL_FORCE_STRING };
  }
  return { v: text, t: CELL_STRING };
}

export function delimitedToWorkbookData(
  text: string,
  identity: { unitId: string; name: string; locale: LocaleType; appVersion: string },
  delimiter?: Delimiter,
): IWorkbookData {
  const rows = parseDelimited(text, delimiter);
  const cellData: Record<number, Record<number, ICellData>> = {};
  let columns = 0;
  rows.forEach((fields, row) => {
    columns = Math.max(columns, fields.length);
    fields.forEach((field, column) => {
      const cell = delimitedCell(field);
      if (cell !== undefined) {
        (cellData[row] ??= {})[column] = cell;
      }
    });
  });
  const sheetId = randomId(SHEET_ID_LENGTH);
  const sheet: Partial<IWorksheetData> = {
    id: sheetId,
    name: 'Sheet1',
    rowCount: Math.max(DEFAULT_ROW_COUNT, rows.length),
    columnCount: Math.max(DEFAULT_COLUMN_COUNT, columns),
    cellData,
  };
  return {
    id: identity.unitId || randomId(ELEMENT_ID_LENGTH),
    name: identity.name,
    appVersion: identity.appVersion,
    locale: identity.locale,
    styles: {},
    sheetOrder: [sheetId],
    sheets: { [sheetId]: sheet },
  };
}

export function exportedText(cell: ICellData | null | undefined): string {
  if (cell === null || cell === undefined) {
    return '';
  }
  const value = cell.v;
  if (value === null || value === undefined) {
    const body = (cell.p as { body?: { dataStream?: string } } | null | undefined)?.body?.dataStream;
    return typeof body === 'string' ? body.replace(/\r?\n$/, '').replace(/\r\n?/g, '\n') : '';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return INJECTION_LEADERS.some((leader) => value.startsWith(leader)) && !CANONICAL_NUMBER.test(value) ? `'${value}` : value;
}

function quoteField(text: string, delimiter: Delimiter): string {
  return text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r')
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

export function sheetToDelimited(sheet: Partial<IWorksheetData>, delimiter: Delimiter = ','): string {
  const cells = sheet.cellData ?? {};
  const rowIndexes = Object.keys(cells).map(Number);
  if (rowIndexes.length === 0) {
    return '';
  }
  const lastRow = Math.max(...rowIndexes);
  let lastColumn = -1;
  for (const row of Object.values(cells) as Record<string, ICellData | null>[]) {
    for (const [column, cell] of Object.entries(row ?? {})) {
      if (exportedText(cell) !== '') {
        lastColumn = Math.max(lastColumn, Number(column));
      }
    }
  }
  const lines: string[] = [];
  for (let row = 0; row <= lastRow; row += 1) {
    const fields: string[] = [];
    for (let column = 0; column <= lastColumn; column += 1) {
      fields.push(quoteField(exportedText(cells[row]?.[column]), delimiter));
    }
    lines.push(fields.join(delimiter));
  }
  while (lines.length > 0 && lines[lines.length - 1].split(delimiter).every((field) => field === '')) {
    lines.pop();
  }
  return lines.map((line) => `${line}\r\n`).join('');
}
