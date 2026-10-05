import type { FormulaCodec, FormulaScope, WorkbookIndex } from './workbook';

export const MAX_ROWS = 1048576;
export const MAX_COLUMNS = 16384;
export const REF_ERROR = '#REF!';

export const TOKEN_OPEN = '⟦';
export const TOKEN_CLOSE = '⟧';
const FIELD = '|';
const ABSOLUTE = '$';

export type ReferenceKind = 'cell' | 'area' | 'rows' | 'columns';

export interface Coordinate {
  index: number;
  absolute: boolean;
}

export interface A1Reference {
  kind: ReferenceKind;
  sheetName?: string;
  startRow?: Coordinate;
  endRow?: Coordinate;
  startColumn?: Coordinate;
  endColumn?: Coordinate;
}

export type FormulaPiece = { text: string } | { reference: A1Reference; text: string };

const IDENTIFIER_CHARACTER = /[A-Za-z0-9_.]/;
const UNQUOTED_SHEET = /^[A-Za-z_][A-Za-z0-9_.]*/;
const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]+)/;
const COLUMN = /^(\$?)([A-Za-z]{1,3})/;
const ROW = /^(\$?)([0-9]+)/;
const AFTER_CELL_OR_COLUMN = /[A-Za-z0-9_.(![]/;
const AFTER_ROW = /[0-9.A-Za-z_(]/;
const ERROR_LITERAL = /^#[A-Za-z0-9/_]*[!?]?/;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

export function columnLetters(index: number): string {
  let letters = '';
  let remaining = index + 1;
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && IDENTIFIER_CHARACTER.test(character);
}

function readQuoted(formula: string, start: number, quote: string): number {
  let position = start + 1;
  while (position < formula.length) {
    if (formula[position] === quote) {
      if (formula[position + 1] === quote) {
        position += 2;
        continue;
      }
      return position + 1;
    }
    position += 1;
  }
  return formula.length;
}

function readBracketed(formula: string, start: number): number {
  let depth = 0;
  let position = start;
  while (position < formula.length) {
    if (formula[position] === '[') {
      depth += 1;
    } else if (formula[position] === ']') {
      depth -= 1;
      if (depth === 0) {
        return position + 1;
      }
    }
    position += 1;
  }
  return formula.length;
}

function cellCoordinates(match: RegExpExecArray): { row: Coordinate; column: Coordinate } | undefined {
  const column = columnIndex(match[2]);
  const row = Number(match[4]) - 1;
  if (column < 0 || column >= MAX_COLUMNS || row < 0 || row >= MAX_ROWS) {
    return undefined;
  }
  return { row: { index: row, absolute: match[3] === ABSOLUTE }, column: { index: column, absolute: match[1] === ABSOLUTE } };
}

function readArea(text: string): { reference: Omit<A1Reference, 'sheetName'>; length: number } | undefined {
  const first = CELL.exec(text);
  if (first !== null) {
    const start = cellCoordinates(first);
    if (start === undefined) {
      return undefined;
    }
    const rest = text.slice(first[0].length);
    if (rest.startsWith(':')) {
      const second = CELL.exec(rest.slice(1));
      if (second !== null && !AFTER_CELL_OR_COLUMN.test(rest[1 + second[0].length] ?? '')) {
        const end = cellCoordinates(second);
        if (end === undefined) {
          return undefined;
        }
        return {
          reference: { kind: 'area', startRow: start.row, startColumn: start.column, endRow: end.row, endColumn: end.column },
          length: first[0].length + 1 + second[0].length,
        };
      }
    }
    if (AFTER_CELL_OR_COLUMN.test(rest[0] ?? '') || rest.startsWith(':')) {
      return undefined;
    }
    return { reference: { kind: 'cell', startRow: start.row, startColumn: start.column }, length: first[0].length };
  }

  const firstColumn = COLUMN.exec(text);
  if (firstColumn !== null && text[firstColumn[0].length] === ':') {
    const second = COLUMN.exec(text.slice(firstColumn[0].length + 1));
    const length = firstColumn[0].length + 1 + (second?.[0].length ?? 0);
    if (second !== null && !AFTER_CELL_OR_COLUMN.test(text[length] ?? '')) {
      const start = columnIndex(firstColumn[2]);
      const end = columnIndex(second[2]);
      if (start < MAX_COLUMNS && end < MAX_COLUMNS) {
        return {
          reference: {
            kind: 'columns',
            startColumn: { index: start, absolute: firstColumn[1] === ABSOLUTE },
            endColumn: { index: end, absolute: second[1] === ABSOLUTE },
          },
          length,
        };
      }
    }
  }

  const firstRow = ROW.exec(text);
  if (firstRow !== null && text[firstRow[0].length] === ':') {
    const second = ROW.exec(text.slice(firstRow[0].length + 1));
    const length = firstRow[0].length + 1 + (second?.[0].length ?? 0);
    if (second !== null && !AFTER_ROW.test(text[length] ?? '')) {
      const start = Number(firstRow[2]) - 1;
      const end = Number(second[2]) - 1;
      if (start >= 0 && end >= 0 && start < MAX_ROWS && end < MAX_ROWS) {
        return {
          reference: {
            kind: 'rows',
            startRow: { index: start, absolute: firstRow[1] === ABSOLUTE },
            endRow: { index: end, absolute: second[1] === ABSOLUTE },
          },
          length,
        };
      }
    }
  }

  return undefined;
}

function readSheetPrefix(formula: string, position: number): { name: string; length: number } | undefined {
  if (formula[position] === "'") {
    const end = readQuoted(formula, position, "'");
    if (formula[end] !== '!' || end - position < 3) {
      return undefined;
    }
    return { name: formula.slice(position + 1, end - 1).replace(/''/g, "'"), length: end + 1 - position };
  }
  const match = UNQUOTED_SHEET.exec(formula.slice(position));
  if (match === null || formula[position + match[0].length] !== '!') {
    return undefined;
  }
  return { name: match[0], length: match[0].length + 1 };
}

export function tokenizeFormula(formula: string): FormulaPiece[] {
  const pieces: FormulaPiece[] = [];
  let raw = '';
  let position = 0;
  const flush = () => {
    if (raw.length > 0) {
      pieces.push({ text: raw });
      raw = '';
    }
  };
  const take = (length: number) => {
    raw += formula.slice(position, position + length);
    position += length;
  };

  while (position < formula.length) {
    const character = formula[position];
    const previous = formula[position - 1];

    if (character === '"') {
      take(readQuoted(formula, position, '"') - position);
      continue;
    }
    if (character === TOKEN_OPEN) {
      const end = formula.indexOf(TOKEN_CLOSE, position);
      take((end === -1 ? formula.length : end + 1) - position);
      continue;
    }
    if (character === '#') {
      take(ERROR_LITERAL.exec(formula.slice(position))?.[0].length ?? 1);
      continue;
    }
    if (character === '[') {
      const end = readBracketed(formula, position);
      let length = end - position;
      if (!isIdentifierCharacter(previous) && previous !== ']') {
        const qualified = readSheetPrefix(formula, end);
        if (qualified !== undefined) {
          length += qualified.length;
          length += readArea(formula.slice(end + qualified.length))?.length ?? 0;
        }
      }
      take(length);
      continue;
    }

    const startsToken = character === "'" || character === ABSOLUTE || isIdentifierCharacter(character);
    if (!startsToken || isIdentifierCharacter(previous) || previous === ABSOLUTE) {
      take(1);
      continue;
    }

    const prefix = readSheetPrefix(formula, position);
    const area = readArea(formula.slice(position + (prefix?.length ?? 0)));
    const external = prefix?.name.startsWith('[') ?? false;
    if (area !== undefined && !external && (prefix === undefined || previous !== ':')) {
      flush();
      const length = (prefix?.length ?? 0) + area.length;
      pieces.push({
        reference: prefix === undefined ? area.reference : { ...area.reference, sheetName: prefix.name },
        text: formula.slice(position, position + length),
      });
      position += length;
      continue;
    }
    if (prefix !== undefined) {
      take(prefix.length + (area?.length ?? 0));
      continue;
    }
    if (character === "'") {
      take(readQuoted(formula, position, "'") - position);
      continue;
    }
    let length = 1;
    while (isIdentifierCharacter(formula[position + length]) || formula[position + length] === ABSOLUTE) {
      length += 1;
    }
    if (formula[position + length] === '[') {
      length = readBracketed(formula, position + length) - position;
    }
    take(length);
  }

  flush();
  return pieces;
}

export function quoteSheetName(name: string): string {
  const plain = UNQUOTED_SHEET.exec(name)?.[0] === name && !/^[A-Za-z]{1,3}[0-9]+$/.test(name) && !/^[Rr][0-9]*[Cc][0-9]*$/.test(name);
  return plain ? name : `'${name.replace(/'/g, "''")}'`;
}

function coordinateText(coordinate: Coordinate, dimension: 'row' | 'column'): string {
  const value = dimension === 'row' ? String(coordinate.index + 1) : columnLetters(coordinate.index);
  return (coordinate.absolute ? ABSOLUTE : '') + value;
}

export function referenceText(reference: A1Reference): string {
  const prefix = reference.sheetName === undefined ? '' : `${quoteSheetName(reference.sheetName)}!`;
  const cell = (row: Coordinate, column: Coordinate) => coordinateText(column, 'column') + coordinateText(row, 'row');
  switch (reference.kind) {
    case 'cell':
      return prefix + cell(reference.startRow!, reference.startColumn!);
    case 'area':
      return `${prefix}${cell(reference.startRow!, reference.startColumn!)}:${cell(reference.endRow!, reference.endColumn!)}`;
    case 'rows':
      return `${prefix}${coordinateText(reference.startRow!, 'row')}:${coordinateText(reference.endRow!, 'row')}`;
    case 'columns':
      return `${prefix}${coordinateText(reference.startColumn!, 'column')}:${coordinateText(reference.endColumn!, 'column')}`;
  }
}

function shiftCoordinate(coordinate: Coordinate | undefined, offset: number, limit: number): Coordinate | undefined | null {
  if (coordinate === undefined) {
    return undefined;
  }
  if (coordinate.absolute || offset === 0) {
    return coordinate;
  }
  const index = coordinate.index + offset;
  return index < 0 || index >= limit ? null : { index, absolute: false };
}

export function shiftFormula(formula: string, rowOffset: number, columnOffset: number): string {
  return tokenizeFormula(formula)
    .map((piece) => {
      if (!('reference' in piece)) {
        return piece.text;
      }
      const reference = piece.reference;
      const startRow = shiftCoordinate(reference.startRow, rowOffset, MAX_ROWS);
      const endRow = shiftCoordinate(reference.endRow, rowOffset, MAX_ROWS);
      const startColumn = shiftCoordinate(reference.startColumn, columnOffset, MAX_COLUMNS);
      const endColumn = shiftCoordinate(reference.endColumn, columnOffset, MAX_COLUMNS);
      if (startRow === null || endRow === null || startColumn === null || endColumn === null) {
        return REF_ERROR;
      }
      return referenceText({ ...reference, startRow, endRow, startColumn, endColumn });
    })
    .join('');
}

export interface SharedFormulaCell {
  f?: string | null;
  si?: string | null;
}

export function expandSharedFormulas<T extends SharedFormulaCell>(
  cells: Record<string | number, Record<string | number, T | null | undefined> | null | undefined>,
): void {
  const masters = new Map<string, { formula: string; row: number; column: number }>();
  for (const [rowKey, row] of Object.entries(cells)) {
    for (const [columnKey, cell] of Object.entries(row ?? {})) {
      if (cell && typeof cell.f === 'string' && cell.f.length > 0 && typeof cell.si === 'string' && cell.si.length > 0) {
        masters.set(cell.si, { formula: cell.f, row: Number(rowKey), column: Number(columnKey) });
      }
    }
  }
  for (const [rowKey, row] of Object.entries(cells)) {
    for (const [columnKey, cell] of Object.entries(row ?? {})) {
      if (!cell || typeof cell.si !== 'string' || cell.si.length === 0) {
        continue;
      }
      if (typeof cell.f !== 'string' || cell.f.length === 0) {
        const master = masters.get(cell.si);
        if (master === undefined) {
          continue;
        }
        cell.f = shiftFormula(master.formula, Number(rowKey) - master.row, Number(columnKey) - master.column);
      }
      cell.si = null;
    }
  }
}

function coordinateField(coordinate: Coordinate | undefined, ids: { idAt(index: number): string | undefined }): string | null {
  if (coordinate === undefined) {
    return '';
  }
  const id = ids.idAt(coordinate.index);
  return id === undefined ? null : (coordinate.absolute ? ABSOLUTE : '') + id;
}

function storeReference(reference: A1Reference, scope: FormulaScope): string | undefined {
  const sheetId = reference.sheetName === undefined ? scope.sheetId : scope.workbook.sheetIdByName(reference.sheetName);
  if (sheetId === undefined || !SAFE_ID.test(sheetId)) {
    return undefined;
  }
  const axes = scope.workbook.sheetAxes(sheetId);
  if (axes === undefined) {
    return undefined;
  }
  const fields = [
    reference.kind,
    reference.sheetName === undefined ? '' : sheetId,
    coordinateField(reference.startRow, axes.rows),
    coordinateField(reference.startColumn, axes.columns),
    coordinateField(reference.endRow, axes.rows),
    coordinateField(reference.endColumn, axes.columns),
  ];
  if (fields.includes(null)) {
    return undefined;
  }
  return TOKEN_OPEN + fields.join(FIELD) + TOKEN_CLOSE;
}

export function storeFormula(formula: string, scope: FormulaScope): string {
  return tokenizeFormula(formula)
    .map((piece) => ('reference' in piece ? (storeReference(piece.reference, scope) ?? piece.text) : piece.text))
    .join('');
}

interface StoredReference {
  kind: ReferenceKind;
  sheetId: string;
  explicit: boolean;
  startRow?: { id: string; absolute: boolean };
  startColumn?: { id: string; absolute: boolean };
  endRow?: { id: string; absolute: boolean };
  endColumn?: { id: string; absolute: boolean };
}

function parseField(field: string | undefined): { id: string; absolute: boolean } | undefined {
  if (field === undefined || field.length === 0) {
    return undefined;
  }
  const absolute = field.startsWith(ABSOLUTE);
  return { id: absolute ? field.slice(1) : field, absolute };
}

function parseStoredReference(token: string, scope: FormulaScope): StoredReference | undefined {
  const fields = token.slice(1, -1).split(FIELD);
  const kind = fields[0] as ReferenceKind;
  if (fields.length !== 6 || !['cell', 'area', 'rows', 'columns'].includes(kind)) {
    return undefined;
  }
  return {
    kind,
    sheetId: fields[1] === '' ? scope.sheetId : fields[1],
    explicit: fields[1] !== '',
    startRow: parseField(fields[2]),
    startColumn: parseField(fields[3]),
    endRow: parseField(fields[4]),
    endColumn: parseField(fields[5]),
  };
}

function resolveSpan(
  start: { id: string; absolute: boolean } | undefined,
  end: { id: string; absolute: boolean } | undefined,
  axis: { indexOf(id: string): number | undefined; startIndexOf(id: string): number | undefined; endIndexOf(id: string): number | undefined },
): [Coordinate, Coordinate] | undefined {
  if (start === undefined || end === undefined) {
    return undefined;
  }
  const liveStart = axis.indexOf(start.id);
  const liveEnd = axis.indexOf(end.id);
  if (liveStart !== undefined && liveEnd !== undefined) {
    const [low, high] = liveStart <= liveEnd ? [liveStart, liveEnd] : [liveEnd, liveStart];
    return [
      { index: low, absolute: start.absolute },
      { index: high, absolute: end.absolute },
    ];
  }
  const from = axis.startIndexOf(start.id);
  const to = axis.endIndexOf(end.id);
  if (from === undefined || to === undefined || from > to) {
    return undefined;
  }
  return [
    { index: from, absolute: start.absolute },
    { index: to, absolute: end.absolute },
  ];
}

function displayReference(stored: StoredReference, workbook: WorkbookIndex): string {
  const axes = workbook.sheetAxes(stored.sheetId);
  if (axes === undefined) {
    return REF_ERROR;
  }
  const sheetName = stored.explicit ? workbook.sheetName(stored.sheetId) : undefined;

  if (stored.kind === 'cell') {
    const row = stored.startRow === undefined ? undefined : axes.rows.indexOf(stored.startRow.id);
    const column = stored.startColumn === undefined ? undefined : axes.columns.indexOf(stored.startColumn.id);
    if (row === undefined || column === undefined) {
      return REF_ERROR;
    }
    return referenceText({
      kind: 'cell',
      sheetName,
      startRow: { index: row, absolute: stored.startRow!.absolute },
      startColumn: { index: column, absolute: stored.startColumn!.absolute },
    });
  }

  const rows = stored.kind === 'columns' ? undefined : resolveSpan(stored.startRow, stored.endRow, axes.rows);
  const columns = stored.kind === 'rows' ? undefined : resolveSpan(stored.startColumn, stored.endColumn, axes.columns);
  if ((stored.kind !== 'columns' && rows === undefined) || (stored.kind !== 'rows' && columns === undefined)) {
    return REF_ERROR;
  }
  return referenceText({
    kind: stored.kind,
    sheetName,
    startRow: rows?.[0],
    endRow: rows?.[1],
    startColumn: columns?.[0],
    endColumn: columns?.[1],
  });
}

export function displayFormula(stored: string, scope: FormulaScope): string {
  let output = '';
  let position = 0;
  while (position < stored.length) {
    const character = stored[position];
    if (character === '"' || character === "'") {
      const end = readQuoted(stored, position, character);
      output += stored.slice(position, end);
      position = end;
      continue;
    }
    if (character === TOKEN_OPEN) {
      const end = stored.indexOf(TOKEN_CLOSE, position);
      if (end === -1) {
        output += stored.slice(position);
        break;
      }
      const token = stored.slice(position, end + 1);
      const reference = parseStoredReference(token, scope);
      output += reference === undefined ? token : displayReference(reference, scope.workbook);
      position = end + 1;
      continue;
    }
    output += character;
    position += 1;
  }
  return output;
}

export function hasStoredReference(stored: string): boolean {
  return stored.includes(TOKEN_OPEN);
}

export const FORMULA_CODEC: FormulaCodec = {
  store: storeFormula,
  display: displayFormula,
};
