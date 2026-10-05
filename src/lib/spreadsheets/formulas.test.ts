import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { IWorkbookData, LocaleType } from '@univerjs/core';
import {
  FORMULA_CODEC,
  REF_ERROR,
  WorkbookIndex,
  createSheet,
  displayFormula,
  expandSharedFormulas,
  fromWorkbookData,
  insertLines,
  markSpreadsheet,
  moveLines,
  quoteSheetName,
  readAxis,
  readSheet,
  removeLines,
  removeSheet,
  shiftFormula,
  storeFormula,
  toWorkbookData,
  tokenizeFormula,
  writeContent,
  writeSheetProperty,
  type FormulaScope,
  type SheetMap,
} from './index';

function references(formula: string): string[] {
  return tokenizeFormula(formula)
    .filter((piece) => 'reference' in piece)
    .map((piece) => piece.text);
}

function workbook(rows = 20, columns = 10): { doc: Y.Doc; first: string; second: string } {
  const doc = new Y.Doc();
  markSpreadsheet(doc);
  const first = createSheet(doc, { name: 'Sheet1', rows, columns });
  const second = createSheet(doc, { name: 'Data 2024', rows, columns });
  return { doc, first, second };
}

function scope(doc: Y.Doc, sheetId: string, row = 0, column = 0): FormulaScope {
  return { sheetId, row, column, workbook: new WorkbookIndex(doc) };
}

function sheetOf(doc: Y.Doc, id: string): SheetMap {
  return readSheet(doc, id) as SheetMap;
}

function replicate(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

function sync(...docs: Y.Doc[]): void {
  const updates = docs.map((doc) => Y.encodeStateAsUpdate(doc));
  for (const doc of docs) {
    for (const update of updates) {
      Y.applyUpdate(doc, update);
    }
  }
}

describe('the reference lexer', () => {
  it.each([
    ['=A1+B2', ['A1', 'B2']],
    ['=$A$1*$b2', ['$A$1', '$b2']],
    ['=SUM(A1:B9)', ['A1:B9']],
    ['=SUM(A:C)+SUM($1:$3)', ['A:C', '$1:$3']],
    ['=Sheet2!A1', ['Sheet2!A1']],
    ["='Data 2024'!B2:C3", ["'Data 2024'!B2:C3"]],
    ["='It''s'!A1", ["'It''s'!A1"]],
    ['=XFD1048576', ['XFD1048576']],
    ['=TAX2024*2', ['TAX2024']],
  ])('finds the references in %s', (formula, expected) => {
    expect(references(formula)).toEqual(expected);
  });

  it.each([
    ['=LOG10(100)', 'a function whose name looks like a cell'],
    ['=SUM(Revenue)', 'a defined name'],
    ['="A1 and B2"', 'a string literal'],
    ['=IF(A1="B2";1;0)', 'a string literal beside a reference'],
    ['=#REF!+1', 'an error literal'],
    ['=Table1[Amount]', 'a structured reference'],
    ['=Table1[[#This Row],[Amount]]', 'a nested structured reference'],
    ['=[1]Sheet1!A1', 'an external workbook'],
    ["='[Book.xlsx]Sheet1'!A1", 'an external workbook, quoted'],
    ['=SUM(Sheet1:Sheet3!A1)', 'a 3D reference'],
    ['=R1C1', 'an R1C1 reference'],
    ['=1.5E+3*2', 'numbers'],
    ['=XFE1', 'a column past XFD'],
    ['=A1048577', 'a row past the last'],
    ['=A1:B', 'an open-ended range'],
  ])('leaves %s alone (%s)', (formula) => {
    const pieces = tokenizeFormula(formula);
    expect(pieces.map((piece) => piece.text).join('')).toBe(formula);
    if (formula !== '=IF(A1="B2";1;0)') {
      expect(references(formula)).toEqual([]);
    } else {
      expect(references(formula)).toEqual(['A1']);
    }
  });

  it('reassembles every formula exactly', () => {
    const formula = "=IF(AND($A$1>0;'My Sheet'!C3:D4<>\"x\");SUM(B:B)/COUNT(2:2);#N/A)";
    expect(tokenizeFormula(formula).map((piece) => piece.text).join('')).toBe(formula);
  });

  it('quotes a sheet name only when it has to', () => {
    expect(quoteSheetName('Sheet1')).toBe('Sheet1');
    expect(quoteSheetName('Data 2024')).toBe("'Data 2024'");
    expect(quoteSheetName("It's")).toBe("'It''s'");
    expect(quoteSheetName('A1')).toBe("'A1'");
    expect(quoteSheetName('R1C1')).toBe("'R1C1'");
  });
});

describe('storing and displaying', () => {
  it.each([
    '=A1+B2',
    '=$A$1*$B2+C$3',
    '=SUM(A1:B9)',
    '=SUM(B:D)+SUM($2:$4)',
    "='Data 2024'!B2+Sheet1!A1",
    '=IF(A1="A1";LOG10(B2);Revenue)',
    '=Table1[Amount]+A1',
  ])('round-trips %s while nothing moves', (formula) => {
    const { doc, first } = workbook();
    const stored = storeFormula(formula, scope(doc, first));
    expect(displayFormula(stored, scope(doc, first))).toBe(formula);
  });

  it('stores ids, not positions', () => {
    const { doc, first } = workbook();
    const stored = storeFormula('=SUM(A1:B9)+C3', scope(doc, first));
    expect(stored).not.toMatch(/A1|B9|C3/);
    expect(stored.startsWith('=SUM(')).toBe(true);
  });

  it('shows references in upper case', () => {
    const { doc, first } = workbook();
    expect(displayFormula(storeFormula('=a1+$b$2', scope(doc, first)), scope(doc, first))).toBe('=A1+$B$2');
  });

  it('keeps a reference past the end of the sheet as text', () => {
    const { doc, first } = workbook(5, 3);
    const stored = storeFormula('=A10+D1+A1', scope(doc, first));
    expect(stored.startsWith('=A10+D1+')).toBe(true);
    expect(displayFormula(stored, scope(doc, first))).toBe('=A10+D1+A1');
  });

  it('keeps a reference to an unknown sheet as text', () => {
    const { doc, first } = workbook();
    expect(storeFormula('=Missing!A1', scope(doc, first))).toBe('=Missing!A1');
  });

  it('follows rows and columns inserted above and to the left', () => {
    const { doc, first } = workbook();
    const stored = storeFormula('=SUM(B2:C4)+$D$5', scope(doc, first));
    insertLines(sheetOf(doc, first), 'rows', 0, 2);
    insertLines(sheetOf(doc, first), 'columns', 0, 1);
    expect(displayFormula(stored, scope(doc, first))).toBe('=SUM(C4:D6)+$E$7');
  });

  it('grows a range with a line inserted inside it, and not with one just past it', () => {
    const { doc, first } = workbook();
    const stored = storeFormula('=SUM(A1:A3)', scope(doc, first));
    insertLines(sheetOf(doc, first), 'rows', 3, 1);
    expect(displayFormula(stored, scope(doc, first))).toBe('=SUM(A1:A3)');
    insertLines(sheetOf(doc, first), 'rows', 1, 1);
    expect(displayFormula(stored, scope(doc, first))).toBe('=SUM(A1:A4)');
  });

  it('shows #REF! for a single reference whose row or column was removed', () => {
    const { doc, first } = workbook();
    const stored = storeFormula('=B2*2+C3', scope(doc, first));
    removeLines(sheetOf(doc, first), 'columns', 1, 1);
    expect(displayFormula(stored, scope(doc, first))).toBe(`=${REF_ERROR}*2+B3`);
  });

  it('shrinks a range whose endpoint was removed, and shows #REF! when all of it was', () => {
    const { doc, first } = workbook();
    const stored = storeFormula('=SUM(A2:A4)', scope(doc, first));
    removeLines(sheetOf(doc, first), 'rows', 3, 1);
    expect(displayFormula(stored, scope(doc, first))).toBe('=SUM(A2:A3)');
    removeLines(sheetOf(doc, first), 'rows', 1, 2);
    expect(displayFormula(stored, scope(doc, first))).toBe(`=SUM(${REF_ERROR})`);
  });

  it('follows a moved row, as a cut and paste would', () => {
    const { doc, first } = workbook();
    const stored = storeFormula('=A1', scope(doc, first));
    moveLines(sheetOf(doc, first), 'rows', 0, 1, 5);
    expect(displayFormula(stored, scope(doc, first))).toBe('=A5');
  });

  it('keeps whole-column and whole-row ranges anchored on their own dimension', () => {
    const { doc, first } = workbook();
    const stored = storeFormula('=SUM(B:C)+SUM(2:3)', scope(doc, first));
    insertLines(sheetOf(doc, first), 'columns', 0, 1);
    insertLines(sheetOf(doc, first), 'rows', 0, 1);
    expect(displayFormula(stored, scope(doc, first))).toBe('=SUM(C:D)+SUM(3:4)');
  });

  it('follows a renamed sheet, and shows #REF! for a removed one', () => {
    const { doc, first, second } = workbook();
    const stored = storeFormula("='Data 2024'!A1", scope(doc, first));
    writeSheetProperty(sheetOf(doc, second), 'name', 'Archive');
    expect(displayFormula(stored, scope(doc, first))).toBe('=Archive!A1');
    removeSheet(doc, second);
    expect(displayFormula(stored, scope(doc, first))).toBe(`=${REF_ERROR}`);
  });

  it('does not mistake a token-looking string literal for a reference', () => {
    const { doc, first } = workbook();
    const literal = '="⟦cell||x|y||⟧"';
    expect(displayFormula(storeFormula(literal, scope(doc, first)), scope(doc, first))).toBe(literal);
  });
});

describe('formulas under concurrent edits', () => {
  it('reads the same cells on both devices after one types a formula and the other inserts inside its range', () => {
    const { doc, first } = workbook();
    const other = replicate(doc);
    const stored = storeFormula('=SUM(A1:A3)', scope(doc, first, 4, 0));
    const sheet = sheetOf(doc, first);
    writeContent(sheet, readAxis(sheet, 'rows').idAt(4)!, readAxis(sheet, 'columns').idAt(0)!, { f: stored });
    insertLines(sheetOf(other, first), 'rows', 1, 1);
    sync(doc, other);
    for (const replica of [doc, other]) {
      const cells = toWorkbookData(replica, IDENTITY, FORMULA_CODEC).sheets[first]!.cellData!;
      expect(cells[5][0]).toEqual({ f: '=SUM(A1:A4)' });
    }
  });

  it('shows #REF! on both devices when the other removes the referenced column', () => {
    const { doc, first } = workbook();
    const other = replicate(doc);
    const sheet = sheetOf(doc, first);
    const stored = storeFormula('=B1*2', scope(doc, first, 0, 2));
    writeContent(sheet, readAxis(sheet, 'rows').idAt(0)!, readAxis(sheet, 'columns').idAt(2)!, { f: stored });
    removeLines(sheetOf(other, first), 'columns', 1, 1);
    sync(doc, other);
    for (const replica of [doc, other]) {
      const cells = toWorkbookData(replica, IDENTITY, FORMULA_CODEC).sheets[first]!.cellData!;
      expect(cells[0][1]).toEqual({ f: `=${REF_ERROR}*2` });
    }
  });

  it('follows a row the other device moved into a range, and shrinks the range it trimmed', () => {
    const { doc, first } = workbook();
    const other = replicate(doc);
    const sheet = sheetOf(doc, first);
    const stored = storeFormula('=A1+SUM(B2:B5)', scope(doc, first, 10, 0));
    writeContent(sheet, readAxis(sheet, 'rows').idAt(10)!, readAxis(sheet, 'columns').idAt(0)!, { f: stored });
    moveLines(sheetOf(other, first), 'rows', 0, 1, 3);
    removeLines(sheetOf(other, first), 'rows', 4, 1);
    sync(doc, other);
    const displays = [doc, other].map(
      (replica) => toWorkbookData(replica, IDENTITY, FORMULA_CODEC).sheets[first]!.cellData![9][0],
    );
    expect(displays[0]).toEqual(displays[1]);
    expect(displays[0]).toEqual({ f: '=A3+SUM(B1:B4)' });
  });
});

const IDENTITY = { unitId: 'unit', name: 'Book', locale: 'enUS' as LocaleType, appVersion: '1.0.3' };

describe('shifting a formula', () => {
  it('moves relative parts and keeps absolute ones', () => {
    expect(shiftFormula('=A1+$A$1+A$1+$A1', 2, 1)).toBe('=B3+$A$1+B$1+$A3');
    expect(shiftFormula('=SUM(A1:B2)+SUM(C:C)+SUM(4:4)', 1, 1)).toBe('=SUM(B2:C3)+SUM(D:D)+SUM(5:5)');
    expect(shiftFormula("='Data 2024'!A1", 1, 0)).toBe("='Data 2024'!A2");
  });

  it('turns a reference shifted off the sheet into #REF!', () => {
    expect(shiftFormula('=A1+B2', -1, 0)).toBe(`=${REF_ERROR}+B1`);
  });
});

describe('shared formulas', () => {
  it('expand into one formula per cell, shifted from the master', () => {
    const cells: Record<number, Record<number, { f?: string | null; si?: string | null; v?: number }>> = {
      0: { 2: { f: '=A1*$B$1', si: 'shared', v: 1 } },
      1: { 2: { si: 'shared', v: 2 } },
      2: { 2: { si: 'shared' }, 3: { si: 'orphan' } },
    };
    expandSharedFormulas(cells);
    expect(cells[0][2]).toMatchObject({ f: '=A1*$B$1', si: null });
    expect(cells[1][2]).toMatchObject({ f: '=A2*$B$1', si: null });
    expect(cells[2][2]).toMatchObject({ f: '=A3*$B$1', si: null });
    expect(cells[2][3]).toEqual({ si: 'orphan' });
  });

  it('are expanded on import without touching the caller’s data', () => {
    const data: IWorkbookData = {
      id: 'unit',
      name: 'Book',
      appVersion: '1.0.3',
      locale: 'enUS' as LocaleType,
      styles: {},
      sheetOrder: ['s'],
      sheets: {
        s: {
          id: 's',
          name: 'Sheet1',
          rowCount: 5,
          columnCount: 3,
          cellData: { 0: { 1: { f: '=A1*2', si: 'x' } }, 1: { 1: { si: 'x' } } },
        },
      },
    };
    const doc = new Y.Doc();
    fromWorkbookData(doc, data, FORMULA_CODEC);
    expect(data.sheets.s!.cellData![1][1]).toEqual({ si: 'x' });
    insertLines(sheetOf(doc, 's'), 'rows', 0, 1);
    const cells = toWorkbookData(doc, IDENTITY, FORMULA_CODEC).sheets.s!.cellData!;
    expect(cells[1][1]).toEqual({ f: '=A2*2' });
    expect(cells[2][1]).toEqual({ f: '=A3*2' });
  });
});
