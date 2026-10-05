# `lib/document-tables`

The arithmetic behind the document editor's tables: how big a new table may be, how a width is
split between columns, and how tall a row may be. Framework-free and unit-tested. The ProseMirror
side — finding the table, reading and writing `colwidth` — is
[`components/documents/tableWidths.ts`](../../components/documents/tableWidths.ts); the menus are
[`TableMenu.tsx`](../../components/documents/TableMenu.tsx) (insert) and
[`TableContextMenu.tsx`](../../components/documents/TableContextMenu.tsx) (everything else).

| Export | What it is |
| --- | --- |
| `TABLE_PICKER_ROWS`, `TABLE_PICKER_COLUMNS` | The size grid in the insert menu: 8 × 10 |
| `MAX_TABLE_ROWS`, `MAX_TABLE_COLUMNS`, `clampTableSize` | What the typed size may be: 1–100 rows, 1–20 columns, whole numbers |
| `MIN_COLUMN_WIDTH_PX` | 24px — no column is made narrower, whatever is asked |
| `evenColumnWidths(total, count)` | A width split evenly, in whole pixels that add up to it — **Distribute columns evenly** |
| `scaleColumnWidths(widths, total)` | A table resized to `total`, its columns kept in proportion — **Fit to text width** |
| `dragColumnBorder(start, column, dragged, available)` | A border drag: an inner border moves width between its two neighbours, the last border grows the table up to `available` |
| `fitColumnWidths(widths, available)` | A table brought within `available`, scaled in proportion only if it is wider |
| `MIN_ROW_HEIGHT_PX`, `MAX_ROW_HEIGHT_PX`, `safeRowHeight(value)` | A row's height: a whole number of pixels from 24 to 2000, from the attribute or from pasted CSS (`48px`), or `undefined` — the only thing that may reach a row's `style` |
| `rowHeightAfterDrag(start, dragged, scale)` | The layout height a drag asks for: the pointer distance undone of the page scale, clamped |

## Widths are pixels in the document

A table's widths are TipTap's own: each cell carries `colwidth`, an array of pixel widths, one per
column it spans. A border drag and the two size commands all write it, and none of them lets the
total pass the text width. When every column has a width, the
table is exactly their sum; when any is missing, the table falls back to the text width
(`width: 100%`, `table-layout: fixed`) and the columns share it. A new table is always created at
the text width. There is no width typed in centimetres: dragging a border, fitting to the text and
distributing evenly cover what a document needs.

A width is set on **every** cell of a column, not only the first row's — a column read from the
first row would lose its width the moment that row is deleted. Sums are kept exact (the remainder
of a split goes one pixel at a time to the first columns).
