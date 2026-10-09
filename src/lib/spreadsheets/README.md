# `lib/spreadsheets` — a spreadsheet as a Yjs CRDT

The `Y.Doc` layout of a spreadsheet, the operations that keep it mergeable, and the converter to
and from Univer's `IWorkbookData`. Framework-free; it never touches Univer at runtime (only its
types) and never touches the network.

A spreadsheet is an item of the documents domain: same API, same sealing, same `DocumentSync`
([`lib/documents`](../documents/README.md)). **Why** it is laid out the way it is — stable ids,
formulas against ids, the kind inside the CRDT, the capacity bound — is
[ADR 00019](../../../../api-general/docs/adr/00019_spreadsheets_in_an_encrypted_crdt.md). This file
says **what** the layout is and how to use it.

## Files

| File          | Role                                                                                 |
| ------------- | ------------------------------------------------------------------------------------ |
| `layout.ts`   | Every key of the `Y.Doc`, the sheet map's shape, and `meta.kind`                       |
| `ids.ts`      | Random ids for rows (8), columns (4), sheets and elements (10), unique within a sheet  |
| `axis.ts`     | `Axis`, the live order of a dimension, and insert / remove / restore / move           |
| `ranges.ts`   | `IdRange`: anchoring a grid range on ids and resolving it back                       |
| `cells.ts`    | Cell content, its encoding from and to Univer's `ICellData`, reading and writing      |
| `styles.ts`   | Content-addressed styles                                                             |
| `sheets.ts`   | Creating, listing, moving, removing sheets, and their properties                     |
| `rules.ts`    | Merges, and id-anchored rules for validation, conditional formatting and filters     |
| `workbook.ts` | `toWorkbookData` / `fromWorkbookData`, `WorkbookIndex` and the `FormulaCodec` seam    |
| `formulas.ts` | The reference lexer, `FORMULA_CODEC` (A1 ↔ ids), shifting, shared-formula expansion  |
| `names.ts`    | Defined names, their formula stored through the codec                                |
| `operations.ts` | `Operation`, every write addressed by id, and `applyOperations` in one transaction  |
| `capacity.ts` | The capacity limit, estimates of what cells and imports cost, and the sync options   |
| `preview.ts`  | A new spreadsheet (`newSpreadsheetDoc`) and the list preview (`readSheetPreview`)     |
| `api.ts`      | `createSpreadsheet`: a new item whose snapshot already holds its first sheet          |
| `xlsx.ts`     | Reading and writing `.xlsx` through ExcelJS, and the report of what was left behind   |
| `csv.ts`      | Parsing and writing CSV and TSV                                                      |
| `interchange.ts` | `importSpreadsheet` and the exports: format, capacity, title and names in one place |
| `charts.ts`   | A chart as a `chart` rule: its settings, its data range and its box, stored by ids; the ECharts option |
| `chart-geometry.ts` | A chart's box on the grid: lines and offsets ↔ pixels, the default placement, moves and resizes |
| `features.ts` | Filters, data validation and conditional formatting as rules: their ids, the formulas inside them, and the conversion to and from Univer's form |
| `xlsx-features.ts` | Those three features in and out of `.xlsx` through ExcelJS |
| `rebuild.ts`  | `rebuildSpreadsheet`: the same spreadsheet in a fresh `Y.Doc`, without its history |
| `rebuild-item.ts` | Rebuilding the item: the copy, its folder, the pointer from the old one, the Trash |
| `sheet-regional.ts` | The spreadsheet's own regional settings in `meta`: read, write, observe |
| `formula-locale.ts` | `localizeFormula` / `canonicalizeFormula`: a formula in the person's syntax and back |
| `function-names/` | The function-name tables, one per language, and `functionNamesFor` |
| `print.ts`    | A sheet's page setup, print area, repeated rows and columns and page breaks, stored by ids |
| `print-layout.ts` | Pagination: `PrintGrid`, `layoutPrint`, a page's regions, and where each cell, gridline and chart lands |
| `print-style.ts` | `cellLook`: Univer's cell style read into what a printed cell needs, every value checked |

## The `Y.Doc`

```
meta            Y.Map    title, kind = 'spreadsheet', replacedBy (the item a rebuild made, once rebuilt),
                         regional (the spreadsheet's own regional settings, a plain object)
sheetOrder      Y.Array  sheet ids, in tab order
sheets          Y.Map    sheet id → sheet map
styles          Y.Map    style id → style JSON
names           Y.Map    name id → { name, formula, sheetId?, comment?, hidden? }

sheet map
  name, hidden, tabColor, freeze, gridlines, gridlinesColor, rightToLeft, defaultStyle,
  defaultRowHeight, defaultColumnWidth, pageSetup
  rowOrder        Y.Array  every row id ever created, in order
  columnOrder     Y.Array  every column id ever created, in order
  removedRows     Y.Map    row id → true
  removedColumns  Y.Map    column id → true
  rows            Y.Map    row id → row line
  columns         Y.Map    column id → column line
  merges          Y.Map    merge id → IdRange
  rules           Y.Map    rule id → { feature, ranges: IdRange[], body, order }

row line (Y.Map)
  <columnId>      cell content
  ~<columnId>     cell style id
  ^size ^hidden ^auto ~    the row's own height, visibility, auto-height flag and style

column line (Y.Map)
  ^size ^hidden ~          width, visibility and style
```

Every top-level container is a root type (`doc.getMap`, `doc.getArray`), so two devices that
open an untouched document never race to create one. Below that, every nested type is created
by exactly one device: a sheet by the one that creates it, a line **with its row or column**
(`insertLines`), never on first write.

## The axis

`readAxis(sheet, 'rows' | 'columns')` reads one dimension into an `Axis`: the live ids in order,
with `indexOf`, `idAt` and `size`. Build one per read, or keep one and rebuild it when the
sequence or the removed map changes; it is a snapshot.

- **The sequence is append-only in spirit.** `removeLines` does not delete the id: it lists it in
  the removed map and deletes the line (its cells). `restoreLines` reverses that in place.
- **`moveLines` deletes and re-inserts the id.** If two devices move the same line at once, the id
  appears twice and **the first occurrence wins** — `Axis` drops the later one.
- **Indexes are in the coordinates before the change**, as Univer's mutations give them:
  `moveLines(sheet, 'rows', 0, 2, 4)` moves the first two rows to sit before the row that was at
  index 4.
- `startIndexOf` / `endIndexOf` resolve a **removed** id to the next or the previous live line.
  That is how a range shrinks rather than breaks.
- Removing a column clears its cells from every row line, so it costs one pass over the rows.
- **Every operation has an id-addressed form**: `insertLineIds` (before a given id, or at the
  end), `removeLineIds` and `moveLineIds`. The index-based ones are built on them. The binding
  uses only the id forms, so an operation means the same thing whenever it is applied — even
  after a remote change has moved every index.

## Cells

A cell's content is one value, written as one key, last-writer-wins:

| Univer cell                        | Stored as             |
| ---------------------------------- | --------------------- |
| `{ v: 3, t: 2 }`                   | `3`                   |
| `{ v: true, t: 3 }`                | `true`                |
| `{ v: 'text', t: 1 }`              | `'text'`              |
| `{ v: '007', t: 4 }` (forced text) | `{ v: '007', t: 4 }`  |
| `{ f: '=A1', v: 9 }`               | `{ f: <stored form> }` |
| `{ p: <rich text> }`               | `{ p: <rich text> }`  |

- **A formula's computed value is never stored**; every device recalculates.
- **A shared formula (`si` without `f`) is refused** with `SharedFormulaError`. Univer writes
  one when a formula is filled down; `fromWorkbookData` expands them first
  (`expandSharedFormulas`), and the binding must do the same before storing a cell.
- `writeContent` and `writeCellStyleId` write nothing when the value is unchanged, so replaying a
  mutation that changed nothing produces no update.
- Univer's `custom` field is not stored.

## Operations

`Operation` is every write the editor makes, each addressed by id: inserting, removing and moving
lines, a cell's content and style, a line's properties, a sheet property, inserting, removing and
moving sheets, the whole set of a sheet's merges, a defined name and the title.
`applyOperations(doc, operations, origin)` applies a batch in **one** transaction. Each write is
skipped when it would not change anything, so replaying an operation produces no update.

## Defined names

`names` holds each defined name with its formula **in stored form** — through the same codec as
a cell, scoped to the name's sheet or, for a workbook-wide name, the first sheet — so a name that
points at `Sheet1!$B$2` follows rows inserted above it on any device.

## Styles

A style id is the first 12 base64url characters of SHA-256 over the style's canonical JSON
(keys sorted, `null` and `undefined` dropped). `internStyle` returns the id, storing the style
if it is new; an empty style has no id. Because the id is the content, two devices that make the
same cell bold write the same id, and `styles` never needs merging.

## Ranges and rules

`anchorRange` turns a grid range into an `IdRange` of four optional endpoint ids; a whole-row
range has no column endpoints and a whole-column range no row endpoints. `resolveRange` turns it
back, or returns `undefined` when every line in it is gone.

- **Merges** resolve the same way; a merge that collapsed to one cell is dropped, and of two
  overlapping merges made concurrently the one with the smaller id is kept, on every device.
- **Rules** carry a `feature` name and an opaque `body`. Which features exist, and what their
  bodies hold, is the binding's business: this module only keeps their ranges anchored. A rule
  whose ranges are all gone is not returned. The features stored as rules are charts
  ([Charts](#charts)), printing ([Printing](#printing)), and filters, validation and conditional
  formatting ([Filters, validation and conditional formatting](#filters-validation-and-conditional-formatting)).

## Charts

A chart is a **rule** of feature `chart` in its sheet's `rules` map: its one range is the data, and
its body is `{ settings, anchor }`. Nothing about a chart is in Univer, which has no chart in its
open-source core; the editor draws it ([`components/spreadsheets`](../../components/spreadsheets/README.md#charts)).

- **The data range** is an `IdRange`, so it grows with a row inserted inside it on any device and
  is gone with the rows it covered. A chart whose data is gone is not returned by `readCharts`.
- **The box** (`StoredAnchor`) is two corners, each a row id and a column id plus an offset in pixels
  inside that cell, at zoom 1. It moves with the lines above and left of it and stretches with
  lines inserted under it. A corner whose line was removed falls back to the nearest end, and the
  box never turns inside out. An offset larger than the cell now is clamped when drawn.
- **`settings`** are cleaned on every read (`normaliseSettings`): an unknown kind is a column chart,
  a title is at most 200 characters, and an empty one is no title.
- **`chartTable` reads the grid the way a person laid it out**: the first row (or column) names the
  series when `headers` is on, a first column of text holds the categories, and the series stop at
  the palette's eight so a colour never repeats. `chartOption` turns that into an ECharts option
  with the app's palette and **its tooltip drawn on the canvas** (`renderMode: 'richText'`), so a
  cell's text is never written into the page as HTML.
- **`writeChart` returns `false` and writes nothing** when a corner or the range lies outside the
  sheet, so a caller never selects a chart that was not stored.

`chart-geometry.ts` is the pixel side, kept free of Univer so it can be tested. A `LineLayout` is a
dimension as Univer's skeleton lays it out — where the first line starts (after the header) and
where each line ends — and `lineAt` finds the line under a coordinate by binary search, skipping
hidden lines, whose size is zero. `anchorRect` and `anchorFromRect` turn a box into pixels and
back; a box is never stored smaller than `MIN_CHART_SIZE`. `defaultChartAnchor` places a new chart
one column right of its data, level with its first row, at 480 × 300.

## Filters, validation and conditional formatting

Univer keeps these three in the workbook's `resources`, outside `IWorkbookData`'s sheets, and its
plugins describe them in Univer's own form (`FeatureRule`: an id, index ranges, a body). Here each
is a rule in its sheet's `rules`, anchored on ids like every other.

| Feature | Rule id | Body |
| --- | --- | --- |
| `filter` | `filter:sheet`, one per sheet | `{ columns: [{ column: <column id>, criteria }] }` — the criteria by column **id**, so an inserted column does not move them onto its neighbour |
| `data-validation` | `dv:<Univer uid>` | Univer's rule without `uid` and `ranges` |
| `conditional-format` | `cf:<Univer cfId>` | `{ stopIfTrue, rule }` |

- **`order`** is the position in Univer's list: a validation's index, a conditional format's
  priority (0 first). The filter's is 0.
- **Formulas go through the codec** (`mapRuleFormulas`), scoped to the **first cell of the rule's
  first range** — Excel's convention for relative references in a rule. Only the places that hold a
  formula are mapped: a validation's `formula1`/`formula2` when they start with `=` (a typed list
  such as `Yes,No` is left alone), a conditional format's formula rule, and a colour scale's, data
  bar's or icon set's value of type `formula`. A text rule that matches `=A1` is text, not a
  reference.
- **An item id is a plain name** (`FEATURE_ITEM_ID`); a rule Univer names otherwise is not stored.
- `storedFeatureRule` turns Univer's form into a stored rule; `featureRulesFromDoc` turns stored
  rules back into Univer's form at the current positions; `writeFeatureRules` stores a list, which
  is what an import does.

How the binding keeps Univer and these rules equal is
[`components/spreadsheets`](../../components/spreadsheets/README.md#filters-validation-and-conditional-formatting).

### In and out of `.xlsx`

`featuresFromExcel` reads a sheet's validations, conditional formats and auto-filter into Univer's
form; `featuresToExcel` writes them back. Univer's form is the pivot, so an import stores exactly
what the editor would have.

- **Validation**: list, whole, decimal, date, time, text length and custom, with operators,
  messages and error style. ExcelJS reads a validation per cell; the cells sharing one are joined
  back into ranges (`cellsToRanges`). A typed list (`"Paid,Pending"`) becomes `Paid,Pending`, a
  reference or a formula keeps its `=`. An export writes at most 100 000 validated cells.
- **Conditional formatting**, in priority order: a formula rule; *cell is* with numbers (with
  references it becomes the equivalent formula); top/bottom *n*; above or below average;
  duplicates and uniques; colour scales; data bars; icon sets (Excel's thresholds turned into
  Univer's highest-first list, `reverse` kept). Excel stores the formula of a text or date-period
  rule, so those come in as formula rules. On the way out, a text rule and a duplicate or unique rule
  are written as the formula Excel evaluates, because ExcelJS cannot write those types.
- **Fill and font** of a rule come in and go out as Excel's differential formats: bold, italic,
  underline, strike, text colour, fill colour.
- **A filter's range** comes in and goes out; **its criteria do not**, because ExcelJS reads only
  the range. The rows it hid are not hidden in the file.
- **Not carried**, and counted on import: a rule with a value of type `formula` in a scale, bar or
  icon set (ExcelJS reads that value as a number), Excel's 2010 icon sets (`3Stars`, `3Triangles`,
  `5Boxes`) and Univer's own (`_5Felling`), and anything else neither side can say.

## A formula in the person's syntax

**What is stored, synced and evaluated is always canonical**: `.` for decimals, `,` between
arguments, English function names — Univer's syntax and Excel's file format. Only what a person
sees in the cell editor and types into it is in their own syntax, which `localizeFormula` and
`canonicalizeFormula` translate (`FormulaSyntax`: the decimal sign, and optionally `FunctionNames`).

- **With a decimal comma**, arguments are separated by `;`, decimals use `,`, and in an array
  constant columns are separated by `\` (rows stay `;`): `=SUM({1,2.5;3,4})` reads
  `=SOMA({1\2,5;3\4})`.
- **Function names** are renamed only where they are called (`NAME(`), plus `TRUE` and `FALSE`;
  a defined name, a sheet name or a reference that looks like a name is left alone. Typing is
  case-insensitive. A name the table does not know is kept as typed, so English always works.
- **Left exactly as written**: string literals, quoted sheet names, structured references in
  brackets, and everything that is not a number, a separator or a function name.
- Error literals (`#REF!`, `#N/A`) and the values Univer computes stay in English.

`formula-locale.test.ts` round-trips each case both ways.

## Regional settings

A spreadsheet carries its own country, date, time and number formats, currency and function
language (`SpreadsheetRegional`, [`lib/regional`](../regional/README.md)) under `meta.regional`, as
one plain object. It is sealed with the rest of the document and synced like any edit, so everyone
in the spreadsheet types and reads it the same way; two people changing it at once keep the last
write, which for a handful of choices made rarely is the right trade over a map per field.

- **`readSheetRegional(doc, account)`** is what the editor uses: the stored settings, each field
  checked by `parseSpreadsheetRegional`, or `spreadsheetDefaults(account)` when there are none — so
  a spreadsheet made before this existed follows the account until someone changes it.
- **Stamped at creation**: `newSpreadsheetDoc(regional)`, `createSpreadsheet(context, regional)` and
  `importSpreadsheet(fileName, bytes, regional)` write them into the first snapshot, from the
  account's formats.
- **Kept by a rebuild**: `rebuildSpreadsheet` copies `meta` whole.
- **Never touches what is stored in cells**: formulas and numbers stay canonical (below); only the
  editor's view of them changes.

`sheet-regional.test.ts` covers the fallback, stamping, sync between replicas, rebuild and import.

## Printing

What a sheet prints is stored in the sheet, so every device prints it the same way; how it is drawn
is [`components/spreadsheets`](../../components/spreadsheets/README.md#printing).

| Setting | Stored as |
| --- | --- |
| Paper, orientation, scale, margins, gridlines, page order | `pageSetup`, one sheet property, last writer wins |
| Print area | the rule `print:area`, feature `print-area`, one `IdRange` |
| Rows repeated on every page | the rule `print:rows`, feature `print-titles`, a whole-row range |
| Columns repeated on every page | the rule `print:columns`, feature `print-titles`, a whole-column range |
| A page break | a rule of feature `page-break` with a random id: a one-row range breaks before that row, a one-column range before that column |

- **The print area and the titles have fixed rule ids** (`:` is outside the id alphabet, so no
  random id can collide), so two devices setting one at once leave one, not two.
- **Everything is anchored on ids.** A print area grows with a row inserted inside it on another
  device; repeated rows follow an insertion above them; a break moves with its row and disappears
  with it. The same break added on two devices reads as one.
- **`readPageSetup` never fails**: an unknown or missing field is its default — the locale's paper
  (`defaultPaperFor`), portrait, actual size, normal margins, gridlines on, down then over. Nothing is
  written until the person changes something.
- **Margins are presets** (normal 2 × 1.8 cm, narrow 1.27 × 0.64 cm, wide 2.54 cm), so a stored value
  can never leave no room on either paper.

### Pagination

`layoutPrint(grid, area, settings, setup)` takes the line sizes in pixels at zoom 1 (`PrintGrid`, a
hidden line at 0) and returns the pages, each a row span and a column span, plus the titles it
repeats. It is the whole of the page logic, tested without a DOM.

- **The printable box** is the paper less the margins, at CSS's 96 px per inch, so a column of 100 px
  prints 26.5 mm wide, as on screen.
- **Scale**: *actual size* is 100 %; *fit to the page width* scales the area's columns (and repeated
  columns) onto one page wide; *fit on one page* scales both ways. A fit only shrinks, never below
  10 %, as in Excel.
- **Breaks**: a page ends where the next line would overflow it, or at a stored break. A fit to the
  width ignores column breaks; a fit on one page ignores all of them.
- **Repeated rows print on a page whose first row comes after them**, so the page that already
  shows them does not show them twice, and they take their height off every page they print on.
  Columns likewise.
- **A line taller than a page** gets a page of its own and is clipped; hidden lines are skipped.
- **Order**: down, then over (Excel's default), or over, then down.
- **At most `MAX_PRINT_PAGES` (250)**; `totalPages` says how many there would have been.
- With no print area, the area is **from A1 to the last cell with content**, a fill or a border,
  including merges and charts (`contentArea`).

A page is up to four **regions** (`pageRegions`): the corner of repeated rows and columns, the
repeated rows, the repeated columns and the body, each with its own origin. `regionCells` places
cells in a region: a merge once, from its first cell, as a box that may reach outside the region and
is clipped by it; text that is not wrapped and not a number **runs into empty neighbours** — right
for left-aligned, left for right-aligned, both ways evenly for centred — the way the grid draws it.
`regionGridlines`, `regionMerges` and `regionCharts` give the rest.

### Cell styles

`cellLook(style, kind)` reads Univer's composed style — font, size in points, bold, italic,
underline, strike, colour, fill, borders by side, alignment, wrapping, padding — with the grid's
defaults (Arial 11, numbers right, booleans centred, text left, bottom-aligned). **Every value that
reaches a stylesheet is checked**: colours through `safeColor` from
[`lib/document-styles`](../document-styles/README.md#what-this-defends-against), font names against a
plain-name pattern and quoted, sizes and paddings clamped. A colour such as `url(…)` stored by
another device can therefore never make the print fetch anything. Rotated and vertical text print
unrotated; rich text prints as plain text in the cell's style.

## The converter

`toSheetData(doc, sheetId, codec)` reads one sheet and the styles it uses, for inserting a sheet
into a running Univer. `fromWorkbookData(doc, data, codec)` writes a Univer workbook into an empty `Y.Doc` — the import
path and the first content of a new spreadsheet. `toWorkbookData(doc, identity, codec)` reads the
whole workbook back for `univer.createUnit`.

Both take a `FormulaCodec`, which turns A1 text into the stored form and back, given the cell it
sits in and a `WorkbookIndex` (every sheet's axes and names). The real one is `FORMULA_CODEC`
([Formulas](#formulas)); a test may pass an identity codec to exercise the plumbing alone.
`fromWorkbookData` expands shared formulas on a copy of the cells, never on the caller's data.

Kept by the converter: values, formulas, rich text, styles of cells, rows and columns, row
heights, column widths, hidden rows and columns, merges, the freeze, tab colour, hidden sheets,
gridlines and their colour, right-to-left, the sheet's default style, default sizes and sheet
order. Univer's `resources` — defined names, filters, validation, conditional formatting — are not
in `IWorkbookData`'s sheets: the binding pushes them into Univer once the unit exists. View state
(zoom, scroll) is not content and is not kept.

## Formulas

A formula is stored with **every reference it can anchor replaced by a token naming ids**, and
the rest of its text — functions, operators, literals, names — kept as typed. `storeFormula`
writes the token; `displayFormula` turns it back into A1 at the current positions.
`FORMULA_CODEC` is the two of them as a `FormulaCodec`.

### The token

```
⟦kind|sheet|startRow|startColumn|endRow|endColumn⟧

kind     cell | area | rows | columns
sheet    empty for the formula's own sheet, written without a prefix; the sheet id otherwise
fields   an id, '$' + id when that part was absolute, empty when the kind has no such part
```

`⟦` and `⟧` are U+27E6 and U+27E7. A token inside a string literal is never read as one, so a
user who types those characters into a string gets them back unchanged.

- **A sheet is named by id**, so renaming a sheet changes how its references read, not what
  they point at. A removed sheet displays as `#REF!`.
- The `$` flags are kept because Univer needs them to copy and fill; they do not change what a
  stored reference points at.

### What the lexer reads as a reference

| Written                              | Kind      |
| ------------------------------------ | --------- |
| `A1`, `$A$1`, `a1`                   | `cell`    |
| `A1:B9`                              | `area`    |
| `A:C`, `$B:$B`                       | `columns` |
| `1:3`, `$2:$2`                       | `rows`    |
| `Sheet2!A1`, `'Data 2024'!A1:B2`     | any, with a sheet |

Columns run to `XFD` and rows to 1 048 576, as in Excel; past either, the text is not a
reference. Column letters are shown upper-case.

**Left exactly as typed**, so their positions do not follow the sheet: function names, even
when they look like cells (`LOG10(`); defined names; string literals; error literals; structured
table references (`Table1[Amount]`); external workbooks (`[1]Sheet1!A1`,
`'[Book.xlsx]Sheet1'!A1`); 3D references (`Sheet1:Sheet3!A1`); R1C1; open-ended ranges
(`A2:A`); a range whose second half names a sheet (`A1:Sheet2!B2`); and any reference to a sheet
that does not exist or to a line past the end of the sheet.

### How a stored reference displays

- **A cell** whose row or column was removed is `#REF!`.
- **A range** follows [Ranges and rules](#ranges-and-rules): it grows with a line inserted
  inside it, ignores one inserted just past it, and shrinks inward when an endpoint is removed;
  when every line is gone it is `#REF!`. If both endpoints are live but a move put the end before
  the start, the two are swapped.
- **A moved line** carries its references with it, as a cut and paste would; a line moved into a
  range is inside it.

### Shifting and shared formulas

`shiftFormula(formula, rows, columns)` moves the relative parts of every reference and leaves the
absolute ones; a part shifted off the sheet becomes `#REF!`. `expandSharedFormulas` uses it to
give every cell of a Univer shared formula (`si`) its own formula, shifted from the master cell
that carries both `f` and `si`, and clears `si`. A cell whose master is missing is left as it is,
and `encodeContent` will then refuse it.

## Capacity

A spreadsheet is bounded by the snapshot the server accepts
([ADR 00019](../../../../api-general/docs/adr/00019_spreadsheets_in_an_encrypted_crdt.md)).
`SNAPSHOT_RAW_BYTES_LIMIT` is that ceiling (`MAX_SNAPSHOT_CHARACTERS` in
[`lib/documents`](../documents/README.md#when-to-compact-and-the-snapshot-ceiling)) taken back
through base64 and the 29-byte seal: about 6.29 MB of Yjs state. **Measured**, a sheet of
200 200 cells — numbers, short text and styled dates — seals to 8 034 768 characters, just under
the 8 387 584 allowed, so the bound is about 200 000 non-empty cells of ordinary data.

- **The limit is in bytes, not cells.** Long text, formulas and styles cost more; `cellsInBytes`
  turns bytes into cells only for a message.
- **Overwriting is not free.** A Yjs map keeps the key of every value it replaced, so each
  overwrite of a cell leaves about 10 bytes behind, forever. A sheet rewritten many times reaches
  the bound with fewer cells than a sheet typed once.
- **Estimates never undercount.** `estimateCellBytes` and `estimateWorkbookBytes` charge a fixed
  overhead per cell, the content's size, a formula's references at the size of their stored
  tokens, a style, and `OVERWRITTEN_CELL_BYTES` for each cell a write replaces. The tests check
  each against the real encoded size for five shapes of sheet: never under, never 60 % over.
- **History is shed only by a rebuild** ([below](#rebuilding-without-the-history)).
- `checkCapacity(used, added, largestCell)` refuses with `workbook-full`, or with
  `cell-too-large` for one cell over `MAX_CELL_BYTES` (64 KiB), which a delta could not carry.
  The binding uses it before every write; an import must call it with `estimateWorkbookBytes`
  before `fromWorkbookData`.
- **`SPREADSHEET_SYNC_OPTIONS`** is what a spreadsheet's `DocumentSync` runs with: compact when
  the log reaches a quarter of the snapshot (64 KiB at least), or after 2 048 deltas. Measured at
  the bound, compacting costs about 0.45 s of encoding and sealing plus an 8 MB upload, while
  replaying 512 single-cell deltas costs 70 ms and 47 KB — so the size of the log, not the number
  of deltas, is what should trigger it.

An empty default sheet (1 000 × 26) is 29 KB. An open `Y.Doc` holds about 480 bytes of memory per
cell.

## Rebuilding without the history

A CRDT keeps a trace of every value it replaced and every line it removed, so a sheet rewritten for
months reaches the capacity bound with fewer cells than it shows. `rebuildSpreadsheet(doc)` writes
the same spreadsheet into a fresh `Y.Doc` and leaves that behind.

- **What it copies**: the live sheets in order, their live rows and columns **with the same ids**,
  each line's properties, each cell of a live column, the sheet properties (freeze, page setup,
  everything that is not structure), merges, every rule, defined names, `meta` (except
  `replacedBy`), and only the styles something still names.
- **What it drops**: removed rows and columns, removed sheets, overwritten values, unused styles.
- **References to removed lines are restated first.** A stored formula or range can point at a
  removed id — `#REF!`, or a range that shrank past it — and resolving that needs the id's place in
  the old sequence. So every formula (cells, names, validation and conditional formats) is displayed
  against the old document and stored again against the new one, and every range, merge, chart
  anchor and filter column is resolved and anchored again on live ids. Each reads exactly as before;
  `#REF!` stays `#REF!`.
- **Checked by comparison**: `rebuild.test.ts` builds a sheet with all of the above, removes and
  inserts lines under it, and requires the rebuilt document to read the same through
  `toWorkbookData`, the charts, the print settings, the merges, the features and the names. A
  sheet overwritten forty times shrinks to under a third of its size, within 10 % of the same
  content typed once.

**It makes a new item for every device** (`rebuildSpreadsheetItem`), because a device that still
holds the old history would merge it straight back:

1. **Only from a device that has caught up**: it flushes, polls, and refuses with
   `RebuildNotSyncedError` unless the sync is `synced`, with nothing pending or uploading and no gap.
2. Builds the snapshot, refusing with `RebuildTooLargeError` if even the content does not fit.
3. Creates the item from it (`createDocumentFromSnapshot`) and moves it into the old one's folder.
4. Writes `replacedBy` into the **old** document and flushes it, so a device that has the old one
   open is told where the new one is.
5. Moves the old item to the Trash.

A failure of 3's folder move or of 5 still returns the new id, with `movedToFolder` and `trashed`
saying what did not happen. Edits another device makes to the old copy after this — one that was
offline — do not reach the new one: that is the price, and the screen says it before asking.

`shouldOfferRebuild` offers it from 80 % of the snapshot ceiling (the last snapshot plus the log
since), or whenever the capacity warns. `rebuildEstimate` measures both sizes, for the screen to say
what a rebuild would save before doing it.

## A new spreadsheet, and its preview

`newSpreadsheetDoc` is a marked spreadsheet with one sheet, *Sheet1*, of 1 000 × 26, with its
regional settings when given.
`createSpreadsheet` creates the item **with that state as its snapshot**, through
`createDocumentFromSnapshot`, so the first sheet exists before any device opens it — two devices
seeding an empty item at once would each create a *Sheet1*.

`readSheetPreview(doc)` is what the documents list draws: the first sheet's top-left cells
(12 × 6) as text — numbers as written, booleans as `TRUE`/`FALSE`, formulas as their A1 text at the
current positions, rich text flattened — each clipped to 24 characters, with empty trailing rows
dropped.

## Files in and out

`importSpreadsheet(fileName, bytes, regional?)` turns an `.xlsx`, `.csv`, `.tsv` or `.txt` file into the
snapshot of a new spreadsheet, **checking the capacity before anything is created**: the estimate
first (`estimateWorkbookBytes` → `checkCapacity`), then the real encoded size, either of which
throws `ImportTooLargeError`. The title is the file name without its extension; defined names are
stored through the codec like any formula. `exportXlsx` and `exportDelimited` take the
**Univer snapshot**, not the CRDT, because only Univer holds the computed values a formula's cached
result and a CSV need.

### Why ExcelJS

Chosen by fidelity, on the corpus below, on 2026-10-04:

| Library | Verdict |
| --- | --- |
| **ExcelJS 4.4.0** (MIT) | Reads and writes values, formulas (expanding shared ones), styles, number formats, merges, frozen panes, sizes, hidden lines and sheets, tab colours, defined names, and sees validation and conditional formatting. Lazy-loaded: 0.24 MiB gzipped, plus JSZip's 0.03 |
| IronCalc | Its xlsx package (`@ironcalc/wasm-xlsx`) is not published; `@ironcalc/wasm` 0.8.4 only reads its own format. It would also need `'wasm-unsafe-eval'` in the CSP |
| SheetJS Community | Reads and writes no styles; its npm release is also stale |

ExcelJS's only `new Function` is its `setImmediate` polyfill, reached only when handed a string,
which nothing does. Import and export were run in Chromium under the production CSP with no
violation and no request. Its `uuid` dependency carries a moderate advisory for v3/v5/v6 with an
output buffer, which ExcelJS does not use.

**ExcelJS assumes Excel's own package layout**, and throws on a valid file laid out otherwise — an
openpyxl comment part (`xl/comments/comment1.xml`, with an absolute relationship target) crashes
its loader. `normalisePackage` therefore runs first: it counts comments, charts, pivot tables and
tables, drops the relationships to the parts this editor does not carry (comments, their VML,
pivot tables, tables), and rewrites absolute relationship targets as relative ones.

### What a round trip keeps, and what it loses

**Kept**, and checked cell by cell by importing the corpus, exporting it and importing it again:
text, numbers, booleans, dates (as serial numbers with their format, 1904 workbooks shifted),
forced text, formulas (shared ones expanded, `_xlfn.` prefixes dropped on the way in and written
back for the functions newer than Excel 2010 on the way out, with Univer's computed value as the
cached result), defined names, bold, italic, underline, strike, font name, size and colour, solid
fills, borders by side, style and colour, horizontal and vertical alignment, wrapping, rotation,
number formats, merges, frozen panes, column widths and row heights, hidden rows, columns and
sheets, tab colours, gridlines, right-to-left, and sheet order.

**Lost, and counted** in the `InterchangeReport` the import returns (and the screen says): comments,
images, charts, tables' formatting, pivot tables, the data validation and conditional formatting
[the converter cannot carry](#in-and-out-of-xlsx), mixed formatting inside one cell (the text is kept), links (the text is kept),
theme colours (Excel's default text colour is not counted), gradient fills, and array formulas
(kept as ordinary ones).

**Approximated**: a column's width is converted at 7 px a character plus 5, a row's height at
4/3 px a point, so a round trip can move either by a pixel; Excel's default font (the theme's,
Calibri 11) is dropped so cells draw in the editor's default.

### CSV and TSV

`parseDelimited` reads RFC 4180 — quoted fields, doubled quotes, delimiters and newlines inside
quotes, CRLF or LF, a byte-order mark — and `detectDelimiter` picks `,`, `;` or a tab from the
first record, ignoring quoted ones. A file that is not UTF-8 is read as Windows-1252.

- **Typing is conservative.** A canonical number (`-3`, `1200.50`, `1e3`) becomes a number,
  `TRUE`/`FALSE` a boolean; a number-looking text that is not canonical (`0042`, `1.234,56`)
  stays text, so no leading zero or locale guess is lost. Locale-aware numbers are 147.9's.
- **Nothing becomes a formula.** A field starting with `=`, `+`, `-` or `@` that is not a number
  is imported as forced text: a CSV is data, and a formula hidden in one is how CSV injection
  works.
- **Exports defuse the same characters.** A text cell starting with one of them is written with a
  leading `'`, so a spreadsheet program opening the file does not run it. Formula cells export
  their computed value. Downloads carry a byte-order mark so Excel reads UTF-8.

### Pasting from Excel and Google Sheets

Univer's own clipboard handles it, and was checked in Chromium through the real clipboard and
Ctrl+V: Excel's HTML, Google Sheets' HTML and plain tab-separated text all land as values, numbers
as numbers.

### The corpus

`src/test/fixtures/xlsx` holds `corpus.xlsx`, `corpus.csv` and `corpus.tsv`, generated by
`tools/xlsx-corpus.py` with openpyxl — a writer independent of the library under test — and edited
at the XML level to add a shared formula, as Excel writes when a formula is filled down. To
regenerate: `PYTHONPATH=<openpyxl> python3 tools/xlsx-corpus.py src/test/fixtures/xlsx`. A file
saved by Excel itself has not been part of it; adding one is the next step when one is at hand.

## Tests

`interchange.test.ts` runs the corpus in and out. `capacity.test.ts` calibrates the estimates against real encoded sizes. `formulas.test.ts` covers the lexer (what it reads and what it leaves alone), the round trip,
every display rule, three concurrent cases with two `Y.Doc`s, shifting and shared formulas.
`spreadsheets.test.ts` covers the rest, and the concurrent cases with two `Y.Doc`s merged
both ways: two insertions at one index, a value typed into a row inserted above, an edit to a
removed row, concurrent moves of one row, a value and a style on one cell, overlapping merges, a
sheet removed while moved, and a range shrinking from a removal made on another device.
`rebuild.test.ts` and `rebuild-item.test.ts` cover the rebuild and the item flow against the fake
document server. `print.test.ts` covers what printing stores and the pagination. `features.test.ts` covers rule
ids and which formulas are mapped; `xlsx-features.test.ts` brings the corpus' validation and
conditional formats in, and round-trips validations, every kind of conditional format the export
writes, and a filter.
