# `components/spreadsheets`

The spreadsheet editor at `/sheets/<id>`: the screen, Univer's interface, and the **binding**
between Univer and the spreadsheet's `Y.Doc`.

Why a spreadsheet is a CRDT, why rows and columns have ids and why formulas are stored against
them is [ADR 00019](../../../../api-general/docs/adr/00019_spreadsheets_in_an_encrypted_crdt.md).
The `Y.Doc` layout, the operations on it and the formula codec are
[`lib/spreadsheets`](../../lib/spreadsheets/README.md). This file is about keeping Univer and the
`Y.Doc` equal.

| File         | Role                                                                                   |
| ------------ | -------------------------------------------------------------------------------------- |
| `SpreadsheetsScreen.tsx` | The Spreadsheets tab: the documents screen on the spreadsheet shelf ([Two shelves, one domain](../documents/README.md#two-shelves-one-domain)) |
| `SpreadsheetWorkspace.tsx` | The page: sync, the title and save status, the capacity notice, the rebuild offer, the notice of a rebuilt copy, and the editor loaded on demand |
| `RebuildDialog.tsx` | What a rebuild would save and cost, and the rebuild itself |
| `SpreadsheetEditor.tsx` | Univer in a container, the binding, undo and redo, and a refused write's message |
| `univer.ts`  | `startSpreadsheetUniver`: which plugins, which locales, the theme, the hidden menu items |
| `memory-storage.ts` | The storage service Univer is given instead of its IndexedDB one          |
| `private-text.ts` | `guardPrivateText`: spellcheck, translation and grammar tools off on every editable element |
| `remote-functions.ts` | `withoutRemoteFunctions`: the formula functions that would fetch a URL, removed |
| `binding.ts` | `SpreadsheetBinding`: the listeners, the pending operations, undo and redo              |
| `capture.ts` | `MutationCapture`: one Univer mutation → `Operation`s on the `Y.Doc`                     |
| `changes.ts` | What a Yjs transaction changed, located by sheet, row and key                           |
| `apply.ts`   | Changes → `fromCollab` Univer mutations                                                 |
| `mirror.ts`  | `WorkbookMirror`, the ids in the order Univer shows them, and the axis and sheet plans |
| `surface.ts` | `UniverSurface`, the few Univer services the binding reads and writes through           |
| `features.ts` | `FeatureModels`, and the capture and reconciliation of filters, validation and conditional formatting |
| `RegionalSettings.tsx` | The spreadsheet's **Settings** menu: its country and the formats it sets, its currency, and the language of its function names |
| `useSheetRegional.ts` | The spreadsheet's own regional settings, read from its document and kept current, with the account's as the fallback |
| `chart-menu.ts` | `registerChartMenu`: the Chart item in Univer's Insert section |
| `ribbon-tabs.ts` | `RibbonTabsSource`: Univer's toolbar sections and the active one, for the tabs in the header |
| `regional.ts` | `applyRegionalSyntax`: Univer's number locale, the editor's translation, general numbers, the preferred currency |
| `capacity.ts` | `CapacityGauge` and what each mutation would add, for the capacity guard              |
| `chart-view.ts` | `ChartViewSource`: the active sheet's lines, scroll, zoom and freeze read off Univer's renderer, the selection, and a range's values |
| `useSheetCharts.ts` | The active sheet's charts with their values, and the view, redrawn once per frame when either changes |
| `ChartLayer.tsx` | The charts over the grid: drawing, selecting, moving, resizing, deleting, and the wheel passed to the grid |
| `ChartCanvas.tsx` | One ECharts instance, with only the chart types and the canvas renderer it needs |
| `ChartPanel.tsx` | The chart's settings beside the grid: title, type, series, headers, data range, delete |
| `print-source.ts` | `SheetPrintReader`: a sheet read off Univer for printing — line sizes, merges, formatted cells, charts |
| `chart-svg.ts` | `chartSvg`: a chart drawn by ECharts as an SVG string, for print |
| `SheetPrint.tsx` | The print preview: the pages, exactly as they print, and the `@page` rule |
| `PrintPanel.tsx` | The page setup beside the preview, and the Print button |

The binding's modules hold no React and are tested in Node against a real, headless Univer 1.0.3
(`binding.test.ts`), with two devices editing offline and then exchanging updates.
`features.test.ts` does the same for filters, validation and conditional formatting, with their
plugins loaded headless.

## The screen

`SpreadsheetWorkspace` opens the item with `SPREADSHEET_SYNC_OPTIONS`, sends a document to
`/docs/<id>`, and shows the title (`meta.title`, the same field as a document's), the save status and
the snapshot's capacity — `near` as a warning, `over` as an error that explains editing still works
but compaction has stopped. `SpreadsheetEditor` is a `next/dynamic` import with `ssr: false`, so
**Univer is downloaded only on this route**: 1.59 MiB gzipped (6.08 MiB raw, 13 scripts and 3
stylesheets) in the production build before 147.13, against 2.9 MB for Univer's own preset. The
filter, validation and conditional formatting plugins added since have not been measured.

**Which plugins** (`univer.ts`): docs, render engine, UI, docs UI, formula engine, sheets, sheets UI,
number formats and their UI, formulas and their UI, and — since 147.13 — filters, data validation
and conditional formatting with their UIs. **Not loaded**: the network plugin the preset adds (an
HTTP service nothing here needs), the filter's worker plugin, the mobile UIs, and every plugin
whose edits the binding does not carry (protection, range themes).

**A rebuild without the history** ([`lib/spreadsheets`](../../lib/spreadsheets/README.md#rebuilding-without-the-history))
is offered in the capacity notice from 80 % of the ceiling, on a full device (it trashes the old
item, which a full device signs). The dialog measures the saving first and says when a rebuild
would barely help, then lists what it costs: a new item, unsaved edits on other devices lost, the old
copy in the Trash for the account's retention (or gone, at zero days), the new copy unshared. On
success the page moves to the new copy. **A copy that was rebuilt** says so above the grid, with a
link to the new one; it can still be edited, but nothing reaches the new copy.

**Settings** opens **this spreadsheet's** regional settings in a modal — its country and the date,
time and number formats and currency it sets, each changeable alone, and the language of its
function names. **They apply to this spreadsheet only**, and they are stored in it
([`lib/spreadsheets`](../../lib/spreadsheets/README.md#regional-settings)): everyone who opens it
reads and types it the same way, on every device, and a change is an edit like any other that
reaches the other people in it. Choosing a country sets every format; *Use the formats of …* puts
them back; *Use my account's formats* takes the account's again.

The account's formats are in **Settings → Region**
([`components/settings`](../settings/README.md#region-the-accounts-formats-and-the-defaults-for-what-comes-next)).
A new or imported spreadsheet is stamped with them (and that country's currency and function
language) when it is created, and keeps them whatever the account later says. A spreadsheet made
before it had settings of its own follows the account until someone changes one. Units and paper
stay the account's: printing starts from the account's paper.

**The toolbar sits in the header, right after the spreadsheet's name**, as in documents, so the
grid starts two rows higher: undo and redo, a divider, then Univer's toolbar sections — **Start**,
**Insert**, **Formulas**, **Data**, **View** — and, at the right edge, **Print**, **Download** and
**Settings**. Below a narrow width the row wraps. The editor owns the toolbar and
renders it into a slot the workspace's header leaves for it (`toolbarSlot`, through a portal); the
header is lifted above Univer's layers so the Download menu opens over the grid.

**The section tabs are ours, the sections are Univer's.** `ribbon-tabs.ts` (`RibbonTabsSource`)
reads Univer's `IRibbonService` — the sections, their localized titles and the active one, including
contextual sections Univer shows and hides — and `setActivatedTab` switches them; Univer still draws
each section's buttons in its own row. Univer's own tab row (`[data-u-comp="ribbon-header-menu"]`)
is hidden by a rule in `globals.css` scoped to `.zekke-sheet-host`, the element Univer is mounted in.

**Chart is an item of Univer's Insert section**, first in its media group (`chart-menu.ts`,
`registerChartMenu`): an operation (`zekke.operation.insert-chart`) whose handler calls the editor's
`insertChart` through a ref, so it always sees the current view; the icon is ours, registered with
Univer's `IconManager` through a wrapper that passes only `className`. Univer shows a toolbar
button's name only in its grid layout, so like the section's other items it is an icon whose
tooltip reads *Chart*. All three registrations are undone when the editor restarts.
Charts are under
[Charts](#charts), printing under [Printing](#printing).
**Download** gives the whole workbook as `.xlsx`, or the sheet in view as
CSV or TSV, built from Univer's snapshot so formulas carry their computed values, and saved
through a `blob:` link — nothing leaves the tab but the file the person asked for.

**Menu items hidden**: Univer's undo and redo, which would read the history the binding clears, and
range and sheet protection — a lock against collaborators, in an account of one, whose mutations
the binding does not carry. The undo and redo buttons above the grid read the binding instead.

**Theme**: Univer's default theme with its `primary` scale replaced by the app's `--color-brand-*`
values, read from the page at start-up, so the brand is defined once in `globals.css`. The app has
no dark mode, so neither does the editor.

**`engine-render` is large because of hyphenation.** Its `index.js` is 1.6 MB; the rest of the
5.4 MB the spike saw is about 80 hyphenation dictionaries (Hungarian alone is 970 KB), which Univer
imports one by one when a language needs them. The production build keeps each as its own chunk,
so none is in the editor's bundle.

**Measured in Chromium** (`playwright-core`, the production modules bundled into a test page), for
a first sheet at the capacity bound of 197 600 cells: the grid is drawn **1.1 s** after the
snapshot starts applying on the laptop (0.3 s to apply the snapshot, 0.15 s to start Univer, the
rest rendering), and **3.1 s** with the CPU throttled four times at a 390 px viewport. A
10 400-cell sheet draws in 0.7 s. No request left the page. A real low-end phone has not been
measured.

## Univer under the zero-knowledge rules

Univer runs in a tab full of plaintext, under the policy in
[`lib/security-headers`](../../lib/security-headers/README.md), and it needs nothing added to it.

- **No worker, no WebAssembly, no `eval`.** The formula engine runs on the main thread: the RPC
  plugin that would move it to a worker is not loaded, so `worker-src` is untouched and
  `'wasm-unsafe-eval'` is not needed. No loaded package calls `eval` or `new Function`.
- **No request leaves the tab.** An editing session in Chromium under the production policy —
  typing values and formulas, bold, copy and paste, pasting HTML with remote images, undo and redo,
  renaming a sheet — made no request but the page's own files, and raised no violation.
  - The only network calls in the loaded packages are two `fetch` in `@univerjs/drawing`'s URL
    image service, which only `UniverDrawingPlugin` registers, and a `Worker` in `@univerjs/rpc`,
    which only its plugin starts. Neither plugin is loaded. The filter imports a controller from
    `@univerjs/rpc` only as an optional dependency, which nothing provides.
  - **The three feature packages add nothing to the list** (reviewed 2026-10-07, all Apache-2.0,
    1.0.3): no request, worker, storage, `eval` or clipboard call. The one image they load is
    conditional formatting's icon sets, each an SVG `data:` URL bundled in the package.
  - `@univerjs/telemetry` is an empty identifier that `sheets-ui` asks for as optional; nothing
    registers it here, so nothing is reported.
  - **`IMAGE()` is removed from the formula engine** (`withoutRemoteFunctions`): it builds an
    `<img>` from the URL in the cell, so a cell could make the browser fetch any address. The
    policy's `img-src` refused it, but a refused attempt is still an attempt; it now evaluates to
    `#NAME?`. `WEBSERVICE` has no implementation in Univer, and no other function fetches.
  - The hyphenation dictionaries are loaded by `import()` from the app's own origin, and only for
    a language that needs them.
- **Nothing is written to the disk.** Univer's storage service — which keeps number-format history,
  usage habits and recent emoji, in IndexedDB with `localStorage` as a fallback — is replaced by
  `MemoryLocalStorageService`. One trace remains: `@univerjs/ui` opens an **empty** IndexedDB
  database named `UniverLocalStorage` when it is imported, at module scope, before any
  configuration can intervene. The session checks it stays empty. The only other direct
  `localStorage` use is the mobile formula panel's recent functions, registered only by
  `UniverSheetsFormulaMobileUIPlugin`, which is not loaded.
- **Every editable element is private.** Univer's cell editor, formula bar, sheet-name and dialog
  inputs — one of them attached to `<body>`, outside the editor's container — get
  `PRIVATE_TEXT_ATTRIBUTES` from `guardPrivateText`, which watches the whole page for as long as
  the editor is mounted. The container is also `translate="no"`, so a page-translation feature
  skips the grid.
- **The clipboard is not cleared after a copy**, as in the document editor: copying cells is the
  person moving their own content, and clearing it would break pasting it elsewhere. The 30-second
  clearing in [`lib/app`](../../lib/app/README.md#copying-a-secret-clears-the-clipboard) is for a
  secret's value copied with a button.

**Pinned by `univer-supply-chain.test.ts`.** It walks every `@univerjs` package the editor imports
and their `@univerjs` dependencies, counts network, worker, storage, clipboard and `eval` calls in
each, and compares the result with the counts above. **An upgrade that adds one fails the test**
until someone reads the new call and updates the list. It also checks that none of the plugins
that would make those calls reachable is imported, and that the storage service is replaced.

## Using the binding

```ts
const univer = new Univer({ locale, locales });
univer.registerPlugin(UniverFormulaEnginePlugin);
univer.registerPlugin(UniverSheetsPlugin);
univer.registerPlugin(UniverSheetsFormulaPlugin);
univer.createUnit(UniverInstanceType.UNIVER_SHEET, toWorkbookData(doc, identity, FORMULA_CODEC));
const binding = new SpreadsheetBinding({ univer, unitId: identity.unitId, doc });
```

**The unit must be created from the same `Y.Doc`**, and the binding constructed before anyone
edits: it reads the order of rows and columns from the document and assumes Univer shows the
same. Dispose the binding before the Univer instance; disposing flushes anything still pending.

**Univer is disposed one task after the editor unmounts.** Univer's UI is its own React root, and
`univer.dispose()` unmounts it synchronously; called from an effect cleanup, that lands while React
is still committing and React refuses it ("Attempted to synchronously unmount a root while React was
already rendering"). `SpreadsheetEditor` therefore disposes the binding at once — that flush must not
wait — hides the instance, and disposes Univer in a `setTimeout`. Each instance is mounted in a host
element of its own inside the container, so a teardown still pending never touches the instance that
replaced it (Strict Mode mounts every effect twice in development).

## The mirror

Univer addresses everything by index; the `Y.Doc` by id. `WorkbookMirror` holds, per sheet, the
row and column ids **in the order Univer currently shows them**, so an index in a Univer
mutation turns into an id without reading the `Y.Doc`. Both directions keep it exact: capture
updates it as it translates a structural mutation, and the remote side updates it as it applies
one. The tests check Univer against the `Y.Doc` after every case, which is what would catch the
mirror drifting.

## Local: capture

Every mutation that is neither `onlyLocal` nor `fromCollab` is translated by `MutationCapture`
into `Operation`s. Those are **addressed by id, never by index** — a row is inserted *before the
row with this id*, a cell is written at *this row id and this column id* — so they mean the same
thing whenever they are applied.

- **A cell is read back from Univer** after the mutation applied, never interpreted from the
  mutation's partial fields: a `set-range-values` that only sets a style, a `move-range`, a
  sort, a number format and a paste all reduce to "read these cells". A cell holding a shared
  formula (`si` without `f`) is resolved through Univer's `FormulaDataModel` first.
- **Univer's own reference rewriting writes nothing.** When a row is inserted, Univer rewrites the
  formulas below it into new A1 text. Stored against ids, the rewritten text is the same token,
  `writeContent` sees no change, and no update is produced.
- **Lines** (height, width, hidden, auto-height, style), **sheet properties** (name, hidden, tab
  colour, freeze, gridlines and their colour, right-to-left, default style), **merges** (the whole
  set, re-anchored), **sheets** (insert with its content, remove, reorder), the **workbook name**
  and **defined names** (their formula through the codec, scoped to their sheet or the first one)
  are each read back the same way.
- **One Yjs transaction per Univer command.** Operations queue while a command runs and are
  applied, in one transaction with origin `CAPTURE_ORIGIN`, when the outermost command finishes.
  A command that awaits between its mutations is flushed at the next microtask instead, so it may
  land as more than one transaction; nothing depends on it being one.

### What is not bound

A mutation the capture does not know is **counted, not stored**: `binding.unbound` maps each
such mutation id to how many times it ran. Four are deliberately ignored: the computed
auto-height, `empty`, `copy-worksheet-end` and `mark-dirty-filter-change`.

Not bound today, because their plugins are not loaded: protection and permissions, range themes.
Filters, data validation and conditional formatting are bound since 147.13
([below](#filters-validation-and-conditional-formatting)). A
`defaultRowHeight` or `defaultColumnWidth` changed on another device is stored but not shown,
because Univer has no mutation for it.

## The person's regional syntax

Univer's engine and editor speak only canonical syntax, and **switching Univer's number locale
alone is unsafe**: under `pt-BR` its parser reads an edited `3.5` as `35`, because its editor shows
stored numbers with a dot. `applyRegionalSyntax` therefore does four things, from the spreadsheet's
own settings ([`lib/regional`](../../lib/regional/README.md)), once per editor:

1. **Univer's number locale** (`setNumfmtLocal`) is the first of the country's own locale and a
   short list (`NUMFMT_CANDIDATES`) whose `numfmt` output matches the preferred decimal sign,
   grouping and date order (`numfmtLocaleFor`). Formatted numbers are drawn and typed numbers and
   dates are read in it; month names follow it. It has no lakh grouping and no space-with-dot.
2. **`BEFORE_CELL_EDIT`** (priority −0.5: after Univer's number-format handler, before the sheets
   plugin's terminal one at −1, below which nothing runs) shows what the editor will hold in the
   person's syntax: a formula through `localizeFormula`, a stored number with its decimal comma at
   full precision, a percentage likewise. **What Univer then parses on Enter is exactly what it
   showed**, so `3,5` comes back as 3.5.
3. **`AFTER_CELL_EDIT`** (priority 10 000, first) turns a typed formula canonical before anything
   else reads it; numbers are left to Univer's parser in the locale of step 1.
4. **General numbers** — no format — are drawn with the decimal comma (`CELL_CONTENT` at priority 1,
   after the number format at 10). Univer's width-based shortening of long general numbers does not
   apply to them.

The **currency button** uses the preferred currency: its symbol as the person's country writes it
(`R$`, `US$`, `€`) is registered in `localeCurrencySymbolMap` under a region of ours, and
`RegionService` points at it. With the canonical syntax, steps 2–4 register nothing.

**A change of settings restarts the editor**, on every device with the spreadsheet open: the
regional fields are in the effect's dependencies, and `useSheetRegional` re-reads them whenever the
document's `regional` entry changes. `regional.test.ts` runs a headless Univer: the round trip of an edited number, the
formula both ways, general and formatted display, the locale choice, the currency, and disposal.

**Not translated**: Univer's formula autocomplete, function help and argument hints (English names,
`,` in the hint), error values, and `TRUE`/`FALSE` displayed in cells.

## Filters, validation and conditional formatting

Each lives in its plugin's model, not in the cells, and the plugins describe edits as their own
mutations: four for the filter, three for validation, four for conditional formatting
(`FEATURE_MUTATIONS`). `FeatureModels` reads and writes the three models; what is stored is in
[`lib/spreadsheets`](../../lib/spreadsheets/README.md#filters-validation-and-conditional-formatting).

- **Local: read back, never interpreted.** A feature mutation only marks its sheet and feature
  dirty. When the command is flushed — after its cell and line operations are applied, so the
  `Y.Doc`'s axes match Univer's — `captureFeature` reads the sheet's whole list for that feature
  off the model, stores each rule by ids, and writes only what differs; a rule gone from the model
  is deleted. A paste, a fill, a sort or a row insertion that makes the plugin move its ranges
  reads back to the same ids and writes nothing.
- **A trimmed range is not rewritten.** When the stored ids still resolve to the range Univer shows
  — rows removed from inside it on this device — the stored ranges are kept. Otherwise the device
  that removed rows would write the whole rule again and erase a change another device made to it
  at the same time; the two-device test of a trim caught that.
- **Remote: reconciled per sheet.** Univer moves a feature's ranges when *its own* command inserts
  or removes lines, not when the binding applies another device's insertion, so every sheet whose
  `rules` changed is reconciled, and every sheet after anything structural (lines, sheets, a sheet
  renamed). `reconcileFeatures` compares, per feature, the rules at the current positions with the
  model's, and when they differ removes the model's and writes the stored ones, `fromCollab`.
  Conditional formats are added last-first, because Univer puts each new one on top.
- **Opening a spreadsheet** reconciles every sheet once, after defined names — the same step.
- **Undo** reverts the rules like any other change, and reaches Univer by the remote path.
- **Filtered rows are hidden by the filter**, through Univer's filtered-rows service, not as hidden
  rows: nothing about them is stored but the filter.

## Charts

Univer's open-source core has no charts, and its host for floating objects (`sheets-drawing-ui`)
needs `UniverDrawingPlugin`, whose URL image service is one of the two network calls
[pinned above](#univer-under-the-zero-knowledge-rules) as unreachable. So **a chart is not a Univer
object**: it is a rule in the `Y.Doc` ([`lib/spreadsheets`](../../lib/spreadsheets/README.md#charts))
drawn by ECharts in a layer of our own over Univer's canvas, and Univer never sees it.

- **Placing it** is what Univer does for its own cell pop-ups: `ChartViewSource.read` takes the
  skeleton's row and column layout, the main viewport's scroll, the scene's zoom and the sheet's
  freeze, and turns a box in sheet pixels into one on the page. The layer is clipped below the
  column header and right of the row header (and of a frozen pane), so a chart scrolls under them.
  **A chart anchored inside a frozen pane is clipped with the rest** — a known gap.
- **When it is redrawn**: `useSheetCharts` re-reads the charts when a transaction touched a sheet's
  `rules` or its row or column order (`collectChanges`), and their values after every Univer
  mutation, which covers typing, a paste, a formula's result and an edit from another device. A
  scroll, a zoom, a resize or a sheet switch only moves them. All of it lands in one
  `requestAnimationFrame`, and `ChartCanvas` skips `setOption` when the option did not change.
- **Its values** are the cells' stored `v`, so a formula shows its computed result. At most
  10 000 rows of a range are read.
- **Editing**: click a chart to select it and open its panel; drag it to move it, drag its corner
  to resize it. A selected chart takes the keyboard: Delete or Backspace removes it, Escape
  deselects it, Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) undo and redo. Clicking the grid deselects the
  chart **but keeps its panel**, so cells can be selected and taken with *Use the selected cells*.
  The wheel over a chart is re-dispatched to Univer's canvas, so the sheet still scrolls.
- **Writing** goes through `binding.editSheet(sheetId, addedBytes, change)`: it flushes what is
  pending, asks the capacity gauge (a chart is counted as 400 bytes), and writes in one
  transaction with `CAPTURE_ORIGIN` between two `stopCapturing` calls. **Each chart change is its
  own undo step**, undone by the same `Y.UndoManager` as a cell, from the buttons or from Univer's
  shortcut. The remote path ignores `rules`, so an undone chart reaches the layer and nothing else.
- **ECharts adds no request.** Only the bar, line, pie and scatter charts, the grid, title, legend
  and tooltip components and the canvas renderer are registered (`echarts/core`), plus the SVG
  renderer for [printing](#printing). Its one
  `new Function` is in the GeoJSON loader of the map chart, which is not imported, and it has no
  network call.
- **Not yet**: charts are not written to or read from `.xlsx`; an import still counts them as lost.

## Printing

**Print** (or Ctrl+P / ⌘P while the editor is open) opens a preview of the sheet in view, with its
page setup beside it. The preview **is** what prints: the browser's print prints the same pages,
and nothing else. What is stored, and how pages are cut, is
[`lib/spreadsheets`](../../lib/spreadsheets/README.md#printing).

- **Why not Univer's canvas.** The canvas draws only the visible part of the sheet, at screen
  resolution; a print needs every page, sharp. The cells are therefore laid out again in HTML, one
  absolutely placed box per cell, from what Univer computed:
  - **the text** is `worksheet.getCell`, after the number-format interceptor — so a date, a currency
    or a percentage prints as the grid shows it, and a number that does not fit prints as Univer
    draws it (`getGeneralNumberDisplayText` rounds a general number, a formatted one becomes `###`);
  - **the style** is `getComposedCellStyleByCellData` — the sheet's, the row's, the column's and the
    cell's own, plus the colour a format gives a negative number — read through `cellLook`;
  - **sizes** are `getRowHeight` (auto heights included) and `getColumnWidth`, a hidden line at 0;
    **merges** are `getMergeData`.
- **Charts print as vector SVG**: `chartSvg` renders ECharts' option server-side style
  (`ssr: true`, no DOM) without its tooltip, and the page shows it as a `data:` image, which
  `img-src` already allows. Inside an `<img>` an SVG can run nothing and load nothing. A chart is
  drawn in the body of every page it reaches, clipped there, so a chart across a break prints in
  two halves.
- **Gridlines** are a line per row and column; a merge covers the ones inside it, a fill covers
  them under it.
- **The page**: each page is a `section` of the paper's size with the margins as padding; inside,
  the regions are scaled by the layout's scale. The `@page` rule (`paperPageRule`) is a `<style>`
  inside the preview, as for documents, because `@page` reads no custom properties. In print, the
  margins move to `@page` and each section becomes exactly the printable box, `break-after: page`.
- **Printing hides everything else**: the preview is portalled to `<body>`, and
  `body:has(> .zekke-sheet-print) > :not(.zekke-sheet-print)` is hidden in print, so the app shell
  and the canvas never reach paper. The panel is `zekke-no-print`.
- **Print waits for the charts**: the Print button decodes every chart image before
  `window.print()`.
- **Settings are edits**: every change in the panel goes through `binding.editSheet` — counted
  against the capacity, one undo step, synced. The preview re-reads the sheet 120 ms after any
  transaction, so an edit from another device shows up.
- **The selection is taken when the preview opens**: *Use the selected cells* sets the print area,
  *Use the selected rows / columns* the repeated lines, and the break buttons break before the
  selection's first row or column.
- **Decrypted content in the DOM**, as in the document editor: the preview is `translate="no"`.
  Every style value has been through `cellLook`'s checks, so nothing stored can make it fetch.

**Not yet**: the whole workbook in one print (each sheet would need its own `@page`), headers and
footers (the browser's own are the print dialog's setting), page breaks dragged in the preview,
rotated text, and print settings in `.xlsx` export and import.

## The capacity guard

**A write that would take the spreadsheet past its capacity is refused before Univer applies it.**
Before every local mutation, the binding estimates what it adds (`mutationGrowth`: cells written,
counting each overwrite; rows and columns inserted; a sheet inserted with its content) and asks
the `CapacityGauge`. A refusal throws Univer's `CustomCommandExecutionError` from the
before-execution hook, which makes Univer skip the mutation and the command return `false`: the
cells are not written, nothing is captured, and `onCapacityRefused` receives the reason, the
bytes used, the bytes the write would add and the limit, for the screen to say so.

- **`CapacityGauge`** keeps an estimate — the encoded document measured once, plus the length of
  every update since — and measures the document again only when a write would bring the estimate
  above 90 % of the limit. Typing on a large sheet never pays for an encode; a paste near the
  limit pays about 0.1 s for an exact answer.
- **What arrives from another device is never refused**, nor an undo: refusing a merge would make
  the devices disagree. Only this device's own writes are guarded.
- `capacityLimitBytes` overrides the limit, which only tests do.

## Remote: apply

Every transaction whose origin is not `CAPTURE_ORIGIN` — another device's update, a snapshot, an
undo — is read for **what it changed** (`collectChanges`): the sheet list, a sheet's properties,
its row or column order, a row's cells by column, a line's properties, merges, names, the title.
The work runs at the next microtask (`settle`), after anything captured locally has been flushed,
so a remote change is never reconciled against a `Y.Doc` that is missing a local one.

`applyChanges` then, with every mutation `fromCollab` so capture never sees it:

1. **Sheets**: removes the ones gone, inserts the new ones whole, then moves the rest into order.
2. **Axes** of a changed sheet: diffs the mirror against the live order — removals, then the lines
   outside the longest increasing subsequence, then insertions — so a moved line is removed and
   re-inserted, and everything that kept its order is left alone.
3. **Cells**: only the changed ones, plus every cell of an inserted row or column, in one
   `set-range-values` per sheet.
4. **Lines**, **merges** (whenever an axis changed too) and **sheet properties**.
5. **Formulas**, when anything structural changed — an axis, a sheet, a sheet's name: every
   formula in the workbook is displayed again and written where its A1 text differs. A row
   inserted elsewhere shifts what `A5` means here, and only a full pass catches every formula
   that pointed below it. Defined names get the same pass.

A single remote cell on a 260 000-cell sheet applies in about 5 ms; a remote row insertion, with
the formula pass, in about 160 ms. A local row insertion on the same sheet takes about 480 ms,
most of it Univer rewriting the 10 000 formulas below it.

## Undo and redo

**Univer's own history is not used.** It would revert by index, and an undo of an index-based
change can undo another device's work. The binding owns a `Y.UndoManager` over the sheets, the
sheet order, the names and the title, **tracking only `CAPTURE_ORIGIN`**: an undo reverts what
this device did, never what arrived from another.

- One undo step is one Univer command: the binding calls `stopCapturing` when the outermost
  command finishes.
- Univer's `univer.command.undo` and `univer.command.redo` are intercepted and run the
  `Y.UndoManager` instead, and Univer's stack is cleared after every command so it never holds
  anything to replay. **Consequence for the screen (147.7)**: Univer's own undo and redo buttons
  read an empty stack and stay disabled; the toolbar has to read `binding.canUndo()` and
  `binding.canRedo()`.
- **The style table is outside the undo scope.** Styles are content-addressed and shared: undoing
  the first use of a style must not delete an entry another device's cell now names.
- An undone change reaches Univer through the same remote path as any other.
