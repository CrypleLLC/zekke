# `components/documents`

| File                    | Role                                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| `DocumentsScreen.tsx`   | The documents grid of page miniatures — opens each document in its own tab |
| `DocumentWorkspace.tsx` | The `/docs/[id]` page: title, toolbar, A4 sheet, counts, save status       |
| `DocumentToolbar.tsx`   | The TipTap formatting toolbar                                              |
| `DocumentOutline.tsx`   | The heading navigation panel beside the sheet                              |
| `pageBreak.ts`          | The `pageBreak` node — the one page decision that is content               |
| `pagination.ts`         | Measures the sheet and decorates where each page starts; off in continuous |
| `useOutline.ts`         | Debounced heading reads off the editor, and `goToHeading`                  |
| `useDocumentSync.ts`    | Binds `DocumentSync` to a component's lifetime                             |
| `ItemHeader.tsx`        | The title field and the save status, shared with the spreadsheet editor    |
| `extensions.ts`         | The TipTap extension set, bound to the document's `Y.Doc`                  |
| `imageNode.ts`          | The `image` node, its view (placement, states, resizing) and paste or drop |
| `imageHost.ts`          | One per open document: inserting, uploading, retrying and opening images   |
| `DocumentMiniature.tsx` | A tile's first page, drawn from the CRDT without an editor                 |

A document's tile is a [`PageTile`](../tiles/README.md); why it looks the way it does is under
[Document and note tiles](../tiles/README.md#document-and-note-tiles). What it draws is the
document's [first page](#first-pages-on-the-documents-screen).

## Documents and spreadsheets in one list

The Documents tab lists both, because a spreadsheet is an item of the same domain
([ADR 00019](../../../../api-general/docs/adr/00019_spreadsheets_in_an_encrypted_crdt.md)). Which is
which is read out of each item's own CRDT (`meta.kind`) while its summary is opened — the server
cannot say. A spreadsheet's tile is its first sheet's top-left cells drawn as a small grid
(`DocumentSummary.grid`), its row carries the sheet icon and the *Spreadsheet* type, and it opens at
`/sheets/<id>` (`documentHref(id, kind)`). The `+` is a `FloatingAddMenu`: a document, a
spreadsheet, or **a spreadsheet imported from a file** (`.xlsx`, `.csv`, `.tsv`). An import is read and
converted in the tab ([`lib/spreadsheets`](../../lib/spreadsheets/README.md#files-in-and-out)); a file
too large is refused before anything is created, and once created a notice names what the file
held that did not come across. A new spreadsheet is created **with its first sheet already in its snapshot**
(`createSpreadsheet`), so no two devices ever race to create it.

Each editor refuses the other's items: `/docs/<id>` on a spreadsheet, or `/sheets/<id>` on a
document, replaces itself with the right route, before any editor is bound to the `Y.Doc` — a
TipTap editor bound to a spreadsheet would start writing a body into it.

`useDocumentSync(id, setup)` takes the engine's options and what to write into an untouched item:
the document editor's default seeds the base font, the spreadsheet editor's seeds a first sheet and
runs with `SPREADSHEET_SYNC_OPTIONS`.

**Sharing compacts first.** A share hands the recipient the item's current *snapshot*, so anything
written since the last compaction would be missing from what they see and copy. `ShareItemDialog`
runs `compactForAnchor` before sending a document or a spreadsheet; when nothing is past the
snapshot, that costs one read.

## The list layout

The documents screen can also be shown as a list, shared with the drive and described in
[Grid or list](../tiles/README.md#grid-or-list). A document's size there is the byte length of
its encoded Yjs state (`DocumentSummary.bytes`), measured after it is opened for the summary: the
server stores a snapshot and a log of updates and reports no size of its own, and this is the
closest honest figure to what the document holds.

## The document editor

The `/docs/[id]` surface is TipTap bound straight to the document's `Y.Doc`, so the editor holds no
content of its own: no `content` option, no `setContent`, no controlled value. Everything the
chrome displays — the outline, the word and page counts, which toolbar buttons are lit — is derived
from `editor.state.doc` on the fly, never written back. A stored attribute would be a sealed delta
appended on every device that opens the document, for a value the editor can recompute for free.
[`lib/documents`](../../lib/documents/README.md) explains why that cost never goes away.

The editable body and the title field carry `PRIVATE_TEXT_ATTRIBUTES` / `PRIVATE_TEXT_PROPS`, so no
spelling, grammar or translation service sees the text, and **the tab title is never the document's
name** — it would land in synced browser history. Why, and what it costs, is in
[`lib/app`](../../lib/app/README.md#plaintext-the-browser-would-otherwise-send-away).

### `useEditorState` must not read the editor out of its own snapshot

This is the trap that made the toolbar render blank on load, and it will bite again.

`useEditor` **does not re-render on transactions** unless `shouldRerenderOnTransaction: true` is
passed, so `editor.isActive('bold')` read during render is frozen at whatever it was when the
component last rendered for some other reason. Reading it that way gives a toolbar that never
lights up and undo/redo buttons that never enable. `useEditorState` is the supported fix: it
subscribes to transactions and re-renders only when the selected value actually changes, which is
also what keeps typing from re-rendering the whole workspace.

Its selector receives `{ editor, transactionNumber }`, and **that `editor` is not reliable**.
`EditorStateManager` caches its snapshot at construction and only rebuilds it when
`transactionNumber` moves; the workspace sets `immediatelyRender: false`, so the cached editor is
`null`, and no transaction fires until the user types. A selector branching on that argument
therefore returns its editor-is-null result forever on an untouched document.

Read the editor from the component's own props instead and let the snapshot serve only as the
invalidation signal:

```ts
const state = useEditorState({
  editor,
  selector: () =>
    editor === null ? undefined : { bold: editor.isActive("bold") },
});
```

A re-render replaces the selector closure, so the value is recomputed as soon as `editor` stops
being null; a transaction bumps `transactionNumber` and recomputes it again. Equality is
`deepEqual` by default, so returning a fresh object of flags each time is correct and cheap.

### The sheet

`.zekke-page-stack` in [`globals.css`](../../app/globals.css) is A4 written in millimetres —
`--page-width: 210mm`, `--page-height: 297mm` and the four `--page-margin-*` — because CSS defines
`1in = 96px = 25.4mm` exactly, so physical units are deterministic here and a pixel width is only a
paper size in disguise. The previous `max-w-[816px]` was US Letter. The margins are the document's
own (see [§ Margins and rulers](#margins-and-rulers)). **The sheet is never resized** — not its
width, not its margins, not on a phone; see [§ Narrow screens](#narrow-screens).

The document renders as **discrete sheets, not one continuous page**. That is two layers: an
`aria-hidden` absolute layer painting one `.zekke-sheet` per page, and the text flowing above it
in a single `.zekke-page` whose `min-height` is `--page-count` pages plus the gaps between them.
The text never moves between containers — splitting it into per-page containers is what would
force a document mutation — so the flow stays one uninterrupted ProseMirror document and only the
background knows about pages.

`.zekke-page` → `.zekke-page-body` → `.ProseMirror` is a three-link flex chain so the editable
element fills the sheet. Without it the lower two-thirds of the page belongs to the sheet rather
than to ProseMirror, and clicking there does nothing. With it, ProseMirror's own hit-testing places
the caret — do not add a click handler calling `focus('end')`, which puts the caret in the wrong
place whenever the user clicked beside a paragraph rather than below the last one.

**On a wide screen the header is one row**: logo, the title with the save status under it, the
formatting toolbar (`DocumentToolbar` with `inline`, taking the rest of the row and wrapping
inside it), and the counts at the end. The title is `TitleInput` with `fit`, which sizes the field
to its own text so the toolbar starts right after the name rather than on the line below. An
`<input>` cannot size itself to its value, so `fit` puts it in a one-cell `inline-grid` with an
invisible copy of the title (or the placeholder) in the same cell: the copy gives the cell its
width, up to `max-w-md`, and the input fills it — `size={1}` removes the input's own ~20-character
intrinsic width, which would otherwise set the cell's minimum. The copy is decrypted content in
the DOM like the input's value, so it carries `translate="no"` and `aria-hidden`. `SaveStatus` is
inset `px-2.25` (9px) — the input's 1px transparent border plus its 8px padding — so the status
starts exactly where the title's text does; spreadsheets share both components and get the same
alignment.

The header is sticky and its height changes when the toolbar wraps, so a `ResizeObserver` writes
the measured height to `--doc-chrome-h` and headings carry a matching `scroll-margin-top`. That is
what keeps an outline click from landing its target underneath the chrome, and it is one
declaration rather than offset arithmetic at each call site.

Printing is the export path: `@media print` hides everything marked `zekke-no-print` (header,
toolbar, outline, rulers) and drops the sheet's border and shadow. The printed margins come from
`printPageRule`, rendered as a `<style>` beside the page from the document's stored margins, so a
print matches the screen. Browser-added headers and footers are the user's print-dialog setting and cannot be
suppressed from CSS.

The page count in the header comes from the pagination plugin, so it is the real number of sheets
rather than a words-per-page guess that would disagree with what prints.

### Pagination

The plugin measures each top-level block, hands the heights to
[`paginate`](../../lib/documents/pagination.ts), and turns the answer into `Decoration.node` entries
that insert a fixed-height spacer before the first block of each page — filling the rest of the
previous sheet and the gutter between sheets. **No document transaction is ever dispatched**; the only transaction
carries `setMeta` and no steps, so nothing reaches the CRDT. Read the reasoning in
[`lib/documents`](../../lib/documents/README.md#pagination-is-measured-never-written) before changing
any of it.

Four details are load-bearing:

- **Widget decorations, not node decorations.** A node decoration is dropped the moment its node
  stops being exactly one node — pressing Enter inside the first block of a page splits it, the
  decoration disappears, and the page collapses upward so the text renders in the gutter between
  sheets. A widget is a single position, which maps through a split intact. It also keeps the
  measurement honest: block heights are read straight off the element, with no injected padding to
  subtract back out.
- **`.zekke-prose` spacing is `margin-top` only**, and `:first-child` gets none. Blocks with a
  `margin-bottom` would collapse against the next block's `margin-top` and the measured heights
  would no longer sum to the rendered flow. The first-child rule matters because `.ProseMirror` is
  a flex item and therefore a BFC root: the first block's margin does _not_ escape it, so without
  the rule page one starts lower than every other page and the arithmetic drifts by that margin.
- **Measure in a microtask, never on a timer or `requestAnimationFrame`.** This is what decides
  whether the feature reads as _"the next line is on the next page"_ or as _"the next line is in
  the gutter and something will move it shortly"_. Microtasks drain before the browser paints, so
  the corrected geometry is in place for the first frame that shows the edit and the intermediate
  state is never rendered. A timer defers past the paint — the text visibly lands in the gutter and
  jumps. rAF is worse still: it runs after layout, and it does not fire at all in a background tab,
  so a document opened in a tab that is not in front would never paginate until you looked at it.
  The layout reads force their own reflow, which is all the frame callback was ever wanted for.
- **The skip check compares block indices _and_ the decorations' live anchor positions.** Skipping
  a rebuild is what keeps typing cheap, but it is only safe when the spacers already on screen are
  where this pass would have put them. Indices alone are not enough: a decoration is anchored to a
  document position, so after an edit that inserts or removes a block, "the break is at index 202"
  can be true of both the old and the new pagination while the spacer is anchored to what is now
  block 203. That renders as text spilling into the gutter and it never recovers, because every
  later pass agrees nothing changed. `sameAnchors` compares each live decoration's `from` against
  the position this pass computed for it, so the rebuild is skipped only when the spacers are
  genuinely already correct. See also
  [`samePagination`](../../lib/documents/README.md#pagination-is-measured-never-written).

`MAX_PASSES` caps the settle loop so a pathological document cannot spin the microtask queue.

### Keeping it cheap on a long document

Measuring on every transaction is what buys the pre-paint correctness, so the measurement itself
has to be cheap. Three things make it so, and all three were found by profiling a 2 000-block,
116-page document rather than by guessing:

|                  | before  | after   |
| ---------------- | ------- | ------- |
| Measurement pass | 70.7 ms | 0.9 ms  |
| Whole keystroke  | 44.3 ms | 21.7 ms |

- **Never call `view.nodeDOM` per block.** It resolves a position by walking siblings, so calling
  it once per top-level node is quadratic — 33.6 ms of the original 70.7 on its own. The elements
  are read from `view.dom.children` in one linear pass instead, skipping the spacer widgets and the
  gap cursor. `elementsByPosition` stays as a fallback for the case where that count disagrees with
  `doc.childCount`, which keeps correctness independent of assumptions about what ProseMirror
  renders.
- **Cache each block's measurement against its ProseMirror node.** Nodes are immutable and shared
  between states, so a node that is `===` the one measured last time cannot have changed height.
  A keystroke re-measures exactly the block it touched. The cache is a `WeakMap`, so it needs no
  eviction, and it is dropped whole when the editor's width changes or a web font finishes loading
  — the two things that change every height at once. Index 0 is never cached, because
  `:first-child` zeroes its margin and that would be wrong for the node anywhere else.
- **Do not dispatch when the pagination did not change.** Most keystrokes do not move a page break,
  and a dispatch is not free: it re-runs every `useEditorState` selector and re-renders the chrome.

The counts in the header are debounced for the same reason. `characterCount.words()` walks the
whole document — 9.3 ms on the 2 000-block document — and through `useEditorState` it ran on every
transaction, twice per keystroke once the pagination dispatch is counted. It is display-only, so it
now reads on a 400 ms trailing debounce like the outline does.

`paginate` uses a prefix-sum array so each page's extent is O(1) and the whole pass is O(n);
`pagination.test.ts` pins that with a 20 000-block case. It was never the bottleneck — 0.45 ms at
10 000 blocks even in the naive form — which is precisely why measuring first was worth it.

The residual page-to-sheet misalignment is bounded at ~1.5 px across 115 page breaks. Rounding the
spacer height is what makes it accumulate, because the sheets sit at exact multiples of the page
height while the spacers stack up rounding error; the height is therefore left fractional.

Print agrees with the screen **by construction** rather than by luck: the spacer is hidden and
`.zekke-page-gap + *` becomes `break-before: page`, so the browser breaks at exactly the blocks
the plugin chose. The `@page` margins from `printPageRule`, with `.zekke-page` padding removed, are
what give pages two and onward their margins — box padding only applies at the start of the box, so the
sheet's own padding cannot serve a multi-page print.

`pageBreak` is an atom node of zero height: it marks the spot without consuming any of the page, so
the page simply ends where the user put it. It is the only pagination fact stored in the document,
and it is stored because it is the user's intent rather than a measurement. `Mod-Enter` inserts
one.

### Margins and rulers

Each document has its own page margins, `meta.margins` in the CRDT, read through
[`lib/document-page`](../../lib/document-page/README.md)'s `pageMargins` guard: **3 cm top and
left, 2 cm right and bottom** for a document created now, the 2.54 cm it was written with for an
older one. `useDocumentSync` seeds them with the base font, in one transaction, the first time an
untouched document is opened.

In page view, [`PageRulers.tsx`](./PageRulers.tsx) draws two rulers:

- **horizontal**, with the left and right margin handles, in `.zekke-ruler-dock` — a sticky row
  just above the sheet, outside the horizontal scroller, that pins itself under the chrome while
  the document scrolls; the ruler inside follows the sheet sideways by measurement
  ([§ Narrow screens](#narrow-screens)). Headings get 2.5rem more `scroll-margin-top` while it is shown so an outline click does not
  land under it;
- **vertical**, with the top and bottom handles, **one per sheet** in `.zekke-ruler-column` — a
  layer laid out exactly like the sheets, with each ruler hanging just outside its sheet's left
  edge — so the top and bottom margins can be set from whichever page is on screen. Only the first
  page's handles are in the tab order and the accessibility tree; the rest are the same sliders
  repeated for the pointer.

The ruler button in the toolbar hides and shows both rulers. Like the view, it is the viewer's
choice, remembered per browser by `readRulersShown` / `writeRulersShown`
([`lib/app`](../../lib/app/README.md)), shown by default, and disabled in continuous view, which has
no rulers. `DocumentWorkspace` sets `data-rulers` on the stack only while rulers are drawn; the
extra heading `scroll-margin-top` keys on it, so hiding the rulers gives that space back.

From `docside` up the vertical ruler hangs in the gap beside the outline, outside the sheet. Below
it the sheet starts at the window's edge, where a ruler outside it could not be scrolled to, so the
ruler sits **inside** the sheet's left edge, over the left margin, layered above the sheet
(`.zekke-ruler-column` is `z-index: 2`, or the sheet's white would cover it).

The ruler is in millimetres from the sheet's edge, so a handle is positioned with `left`, `right`,
`top` or `bottom` set to the margin itself — no measurement. The right handle is anchored to the
sheet's **actual** right edge, which is where the padding is, even when a narrow window makes the
sheet less than 210mm wide. Ticks are two background gradients (1 cm and 5 mm); only the
centimetre numbers are elements.

**A handle is a `role="slider"`.** Dragging snaps to 2.5 mm (Alt: 0.5 mm) and is clamped by
`moveMargin`, which keeps margins non-negative and always leaves 5 cm of text between a side and
its opposite. Keys: arrows ±2.5 mm, Shift ±1 cm, Alt ±0.5 mm, Home/End to the limits; the value
shows in a bubble while dragging or focused.

**Dragging previews; releasing writes.** Each pointer move sets local preview margins, which drive
the CSS properties and therefore the live reflow; `pointerup` writes `meta.margins` once, and only
if it changed. Writing on every move would append a sealed delta per frame to a document's
permanent log ([§ Debounce is a storage decision](../../lib/documents/README.md#debounce-is-a-storage-decision)).
The keyboard does the same: keydown previews, keyup or blur commits. A cancelled pointer drops the
preview.

**Pagination follows.** The plugin's geometry reads `padding-top` and `padding-bottom` separately
— a page holds `--page-height` minus both, and the gap widget spans the bottom margin, the gutter
and the next top margin. A left or right change resizes the editor, which the `ResizeObserver`
already answers; a top or bottom change does not, so `DocumentWorkspace` calls
`remeasurePagination`, a meta-only transaction that bumps the plugin's `revision`, which the
measuring view treats like a mode switch: drop the caches, measure from scratch.

The document miniatures on the documents screen still draw the 2.54 cm margin; they are a sketch
of a page, not of its margins.

### Pages or continuous

The toolbar's last pair of buttons switches between **page view** — the A4 sheets above — and
**continuous view**, one column of text with no sheets. The choice is the viewer's, not the
document's: it is remembered per browser by `readDocumentView` / `writeDocumentView`
([`lib/app`](../../lib/app/README.md)), defaults to pages, and nothing about it is written to the
document.

**The DOM is the same in both.** `DocumentWorkspace` sets `data-view` on `.zekke-page-stack`, and
CSS does the rest: in continuous view the sheets are hidden (and none are rendered), the stack is
`--continuous-width` (62.4rem) wide, centred in the column beside the outline exactly as the sheet
is, and `.zekke-page` loses its padding and its page-multiple height. Unlike the sheet, the column
may narrow with the window, but never below `48ch` — 48 characters of the document's base font,
which is set on the stack for exactly that reason (and so the rulers set their own font back).
Below `docside` that floor is dropped: the text takes the full width of the window, less a 1rem
gutter on each side, and never scrolls sideways. Swapping the element instead
would remount `EditorContent`, and with it the editor's view and selection.

**Pagination is switched off, not hidden.** The plugin state carries `enabled`;
`setPaginated(enabled)` flips it through `markPaginated`, a meta-only transaction kept out of the
undo history. While it is off:

- the state drops its spacers and its page starts, so no gap widget is rendered;
- `PaginationView.measure` returns before reading anything, so typing costs no layout reads;
- a measurement already queued when it was switched off is ignored by `apply`;
- `pageCountOf` returns `undefined`, and the header's counts leave the pages out, because a page
  count of a view with no pages would be a guess.

Switching back invalidates the measurement cache and forces a full pass, since the column width —
and with it every block height — has changed. The editor is created with the remembered mode
(`documentExtensions(doc, { paginated })`) so a continuous view never paginates on its first
frame, and an effect calls `setPaginated` on every change after that.

**Page breaks stay in the document in both views.** In continuous view a `pageBreak` takes no
space, as in page view — the spacing a break causes there is the gap widget that starts the next
page, which no longer exists. Its label shrinks to the dashed rule alone, drawn inside the next
block's top margin, so the break is still visible and selectable without pushing text apart.
Printing is unchanged: a break is `break-after: page` whatever the view.

The tests are in `pagination.test.ts` here, against a bare `EditorState`: the node test
environment has no DOM, so they cover the state transitions and not the measuring view.

### Narrow screens

`docside` is a breakpoint of its own, `--breakpoint-docside: 81.25rem` (1300px) in
`globals.css`, replacing `lg` everywhere in the document layout. It is where the full desktop
chrome (title row and formatting toolbar), the side outline and the outside vertical ruler give
way to the slim bar, the outline drawer and the ruler inside the sheet. It started at 1090px, the
narrowest window holding an A4 sheet beside a 15rem outline; it was moved to 1300px so the
desktop chrome and the 320px side outline only appear where they have room — at 1300px a full A4
sheet, the 21.5rem outline reserve and the gutters fit without scaling. 1300 rather than 1400 keeps the desktop chrome on 1366×768 screens. The `max-width` queries
use 81.1875rem, a sixteenth of a rem below, so the two sides never overlap.

Below `docside`:

- the frame is a **column** holding only the sheet, with the outline button just above it
  ([§ Mobile chrome](#mobile-chrome));
- the sheet is **drawn smaller, never laid out smaller**: when the column is narrower than A4,
  `usePageScale` computes `pageScaleFor(column width)` — the column over 210mm, at most 1 — and
  the stack gets `transform: scale(s)` from its top-left corner. Its layout is untouched: still
  210mm wide with the document's margins, the same font sizes, the same line breaks and page
  breaks as on a desktop; only the drawing shrinks, the way a print preview does. The stack sits
  in `.zekke-page-scale`, a box sized to the drawing (`210mm × s` wide, the stack's layout height
  × s tall, measured by a `ResizeObserver`) and clipping the untransformed layout box, so nothing
  overflows and there is **no horizontal scroll**. `--page-scale` is set on the text column for
  everything that has to agree with the drawing;
- **the rulers are not scaled with it.** Inside the transform their 9px numbers and their handles
  would shrink to an unreadable, untouchable size, so the vertical rulers sit beside the stack in
  the scale box, not inside it, and every millimetre a ruler draws — margin zones, numbers, ticks,
  handle positions, slot heights and the gap between pages — is `calc(<mm> × var(--page-scale))`.
  The ruler keeps its own size and its proportions match the page; a drag divides the pointer
  distance by the scale before converting it to millimetres;
- **pagination measures in layout pixels.** `getBoundingClientRect` reports the drawn, scaled
  size while computed padding and margins are layout values, so the plugin reads `--page-scale`
  with the rest of the page geometry and divides every rectangle — block heights and the probed
  page height and gap — by it. A scale change does not resize the editor's layout box, which is
  what the `ResizeObserver` watches, so `DocumentWorkspace` asks for `remeasurePagination` when
  the scale changes, as it does for the top and bottom margins;
- the sheet still sits in `.zekke-page-scroller` (`overflow-x: auto` below `docside`), and the
  horizontal ruler and the outline button live above it, outside it. The scaled sheet always
  fits, so the scroller no longer scrolls in practice; it stays as the boundary that keeps any
  overflow out of the document. When the document itself is wider than the screen, a phone
  browser pans the visual viewport across it and `position: sticky` or `fixed` elements — the
  header included — pan with it. A scroller is a scroll container on both axes, so nothing inside
  it could stick to the top of the window, which is why the ruler and the button are outside. The
  ruler's dock is a sticky row as wide as the column, clipping sideways (`overflow-x: clip`, which
  unlike `hidden` creates no scroll container), and `HorizontalRuler` places the ruler inside it
  by measurement — the sheet's drawn width and its offset from the row, on every scroll of the
  scroller and every resize of either;
- continuous view never overflows: the text is `width: 100%` of its column with no `48ch` floor,
  inside a 1rem gutter that is padding on the column rather than the frame, so nothing is ever
  wider than the window and there is no horizontal scroll.

### Mobile chrome

Below `docside` the three layers of chrome — title and status, the formatting toolbar, the outline
— took a third of a phone's height. They are rearranged on the pattern mobile editors share:

- **One slim bar.** The header is a single ~48px row: back, the title, a status dot and — on touch,
  where the formatting toolbar has moved to the dock — the four view buttons the wide toolbar ends
  with: page view, continuous view, rulers and print. They are `ViewControls`, exported from
  `DocumentToolbar` so both places render the same buttons, each with its icon; there is no
  overflow menu to open first. The title is `TitleInput` with `compact` — `text-title` instead of
  `text-headline`, and no `max-w-md` — so it takes whatever the buttons leave and truncates. The
  dot is the save state in one glance, from `saveIndicator` in
  [`lib/app/documents.ts`](../../lib/app/documents.ts): **red** as soon as there is a change the
  server does not have — waiting out the debounce, kept offline, or sync paused; **yellow** while
  a push is on its way; **green** once everything written has landed and nothing has changed since;
  grey while the document opens. Red and yellow are told apart by `SyncState.uploading`, because
  `status: "saving"` covers both the wait and the push. Its accessible name and tooltip are
  `saveIndicatorLabel` — "Changes not saved yet", "Saving…", "All changes saved", or the offline
  and gap messages `SaveStatus` shows on a wide screen. The word,
  character and page counts are not shown in the slim bar.
- **Quick return — on touch only.** On a touch device the bar slides away as the reader scrolls
  down and comes back on **any** scroll up of 12px or more, anywhere in the document, not only at
  the top. With a mouse the chrome is always visible, at any width: there is no keyboard competing
  for the screen, and a header that moves under a pointer is just a moving target. The rule is
  `nextQuickReturn` in [`lib/app/scroll-chrome.ts`](../../lib/app/scroll-chrome.ts): distance is
  accumulated per direction from where the direction last changed, so jitter does not flicker it,
  and it is always shown within the chrome's own height of the top. It stays shown while the title
  is focused or the outline drawer is up. `useQuickReturn` coalesces scroll to
  one frame, and hides with `transform`, which moves nothing in the layout — pagination never
  notices. It writes `--doc-chrome-visible` (the chrome's height, or `0px`), which the sticky
  ruler and the floating outline button follow with a matching transition.
- **Formatting above the keyboard — on touch only.** On a device whose primary pointer is coarse
  (`useCoarsePointer`, `(pointer: coarse)`), the toolbar leaves the header and lives in `FormatDock`, a
  fixed bar at the bottom that is shown only while the editor — or the dock itself, say the font
  size box — holds focus (`useEditing`, settled a tick after each `focusin`/`focusout` so moving
  between the two does not blink it). It is the same `DocumentToolbar` with `docked`: one row,
  scrolling sideways, without the view, ruler and print buttons the menu already has. Its
  popovers carry `data-popover`, and inside the dock they are `position: fixed` above it — an
  absolutely positioned popover would be clipped by the row's `overflow-x`, and would open
  downwards into the keyboard. Toolbar buttons already `preventDefault` on `mousedown`, which is
  what keeps the caret, and the keyboard, where they are.
- **Above the keyboard on both platforms.** `app/docs/layout.tsx` sets
  `interactive-widget=resizes-content` for the documents route, so on Android the keyboard shrinks
  the layout viewport and a `bottom: 0` bar sits on top of it. iOS ignores that and overlays the
  keyboard, so `useKeyboardInset` reads `visualViewport` and writes `--keyboard-inset` — how much
  of the layout viewport the visual one no longer covers (`keyboardInset`) — which the dock and
  its popovers add to their `bottom`. On Android the two agree on zero.
- **The outline is a drawer from the left**, opened from a floating button in the body of the
  page rather than the chrome: just above the text in continuous view, just above the first sheet
  in page view. The button is `.zekke-outline-float` — sticky at the top (under the chrome, and
  under the ruler when rulers are shown) and at the left, so it stays where it is however the text
  is scrolled, either way; it has a surface, a border and a shadow because it floats over the text.
  It sits in a wrapper with the stack — a column below `docside`, `display: contents` above it, so
  the wide layout is unchanged — which lines it up with the text's or the sheet's left edge, and
  inserting it never remounts the editor. The drawer is `OutlineDrawer`: a modal dialog on the
  left, `min(20rem, 85vw)` wide and the full height, using the shared `useDialogLifecycle` and
  `trapDialogKeys`, closing on a choice, the backdrop or Escape. Choosing a heading scrolls to it
  **without focusing the editor** (`goToHeading(…, { focus: false })`), because on a phone focus
  would raise the keyboard over the section the reader asked to see. On a wide screen, where the
  outline and the text are on screen together, the button belongs to the outline rather than the
  text: it heads the side panel, sticky with it, and expands and collapses it instead of opening
  the drawer. It carries `aria-expanded` and is tinted while the panel is out, and the choice is
  remembered per browser by `readOutlineShown` / `writeOutlineShown`
  ([`lib/app`](../../lib/app/README.md)), expanded by default. Collapsed, only the button is left
  in the panel's place, and the panel's width is given back to the text. Both are one `OutlineList`, fed by a single
  `useOutline` / `useScrolledHeading` in `DocumentWorkspace`.

A narrow window with a mouse — a desktop browser made small — has no on-screen keyboard to dock
against, and a toolbar that appears only while typing would hide the formatting a mouse user
reaches for before they type. There the toolbar stays in the header, wrapping as on a wide screen
and carrying the view buttons itself, so the slim row has none. The slim row and the outline
drawer follow the width alone; quick return follows the pointer.

`useWideLayout` and `useCoarsePointer` are `matchMedia` through `useSyncExternalStore`; together
they decide which arrangement React renders — the toolbar exists once, in the header or in the
dock (`docked = !wide && coarse`), never both, and `useKeyboardInset` runs only when it is docked. The editor scrolls the caret clear of the chrome and the dock with
`scrollThreshold`/`scrollMargin` (120px above, 96px below), and below `docside` the frame has
5rem of bottom padding so the last line can be scrolled above the dock.

### The outline panel

`readOutline` walks only top-level blocks — returning `false` from the `descendants` callback stops
the descent — so a heading inside a table cell or a blockquote is not a section. Entries carry a
ProseMirror **position**, which is valid only for the state it was read from, so the outline is
re-read on every change rather than cached across transactions.

Nesting is a stack that pops while the top is at or below the incoming level, which handles a
document whose headings skip a level or never start at `h1`. Rows indent by **tree depth, not
heading level**, or a document written entirely in `h2` renders permanently indented.
`outlineTree` and `headingAtScroll` are pure and live in
[`lib/documents/outline.ts`](../../lib/documents/outline.ts) with tests; only the DOM scroll stays here.

From `docside` up the panel **never moves the text**, expanded or collapsed. It is an overlay,
not a column: `OutlinePanel` is a zero-width, sticky flex item (`w-0 shrink-0 overflow-visible`,
`z-[6]`) at the frame's left, and the panel inside it hangs over the left gutter. The text column
takes the frame's whole width, so the sheet or the text is centred on the frame and stays exactly
there when the panel opens or closes. The frame has no maximum width any more, so on a very wide
screen the gutter is real room.

The panel's width is the gutter it has: `.zekke-outline` is
`clamp(20rem, (100cqw − 210mm) / 2 − 1.5rem, 30rem)` — never narrower than 320px while it sits beside the text — in page view and the same with 62.4rem, the
continuous text width, in continuous view. `cqw` is the frame's width — the frame is an
`inline-size` container — because the panel's own containing block is zero wide and `%` would be
nothing.

So that it never covers the text either, **room for the panel is reserved on the left whether
it is open or not**: `--outline-reserve`, 21.5rem — the panel's 20rem minimum and the 1.5rem gap.
The text is centred on the frame when that leaves the reserve free, and otherwise starts at the
reserve, so as a window narrows below about 1720px the text keeps its left edge and moves towards
the right one instead of keeping an empty right margin as wide as the outline. Only
`--right-gutter`, 1.5rem, is kept on the right. In continuous view that is the stack's
`width: min(62.4rem, 100cqw − reserve − gutter)` with
`margin-left: max(reserve, (100cqw − width) / 2)` and `margin-right: auto`, which wins over the
parent's centring. In page view the sheet cannot narrow, so `usePageScale` subtracts the reserve
and the gutter (23rem) from the width it fits the sheet into, the scale box exposes its drawn
width as `--page-box-width`, and the same `margin-left` places it; a screen too narrow for A4 plus
those 23rem draws the sheet scaled down, exactly as on a phone ([§ Narrow screens](#narrow-screens)).
Print drops the margins with the scale. The panel's background is the ground colour, invisible
against the gutter, so that if anything ever does pass under it, it is hidden rather than drawn
through the heading list. Below `docside` the outline is a drawer
instead ([§ Mobile chrome](#mobile-chrome)). The widths are classes in `globals.css` rather than
arbitrary Tailwind values because the formulas and their reasons belong next to the sheet's
`--page-width`.

The panel has no card of its own: rows sit on the page's ground, each heading marked by a solid
bullet. The bullet is its own `aria-hidden` span beside the text, so a long heading **wraps** onto
more lines aligned after the bullet rather than under it, and is never truncated — a section name
cut to "…" is often indistinguishable from its neighbours. The active row keeps `brand-50`; hover
uses `line`, since `raised` is the ground colour and would not show.

The active row follows the **scroll position**, through `useScrolledHeading` in `useOutline.ts`:
it is the section being read, which is what the outline is for, and a writer typing below the
fold still gets there because the editor scrolls the caret into view. The rule is
`headingAtScroll` in [`lib/documents/outline.ts`](../../lib/documents/outline.ts):

- the active heading is the last one whose top has passed the **reading line** — the heading's own
  `scroll-margin-top` (just under the sticky chrome) plus 8px, so a heading an outline click
  scrolls to is exactly the one that lights up;
- before any heading has passed it, the first heading is active if it is on screen, so a freshly
  opened document has its first section lit rather than nothing;
- once the page cannot scroll further, the last heading **on screen** wins, or the final sections
  of a short tail could never be reached.

Measurement runs on `scroll` and `resize`, coalesced to one `requestAnimationFrame` — it only
paints a highlight, so unlike pagination there is nothing to get in before the frame, and a
background tab doing nothing is correct. It re-reads whenever the outline entries change, which
covers a layout shift from an edit. Elements come from `view.nodeDOM` per heading — the quadratic
cost the pagination plugin avoids is negligible over a handful of headings — and anything that is
no longer an `h1`–`h6` is skipped, since the entries trail the document by the outline's 200 ms
debounce. An `IntersectionObserver` was the alternative and is worse here: it would need
re-attaching on every transaction, because ProseMirror replaces heading elements as the document
changes.

When the panel overflows, the active row is kept in view by adjusting the `<nav>`'s own
`scrollTop`, never `scrollIntoView`, which would also scroll the page — on a phone, where the panel
sits above the document, it would yank the reader back to the top.

The panel is `sticky` on the flex **item**, not on the `<nav>` inside it — a sticky element can
only travel within its parent's box, and with `items-start` that wrapper is only as tall as the
nav, so sticking the nav does nothing at all.

### Toolbar

Buttons reflect state (`aria-pressed`, `disabled` from `can()`), every command chains through
`.focus()`, and each control's `onMouseDown` is prevented so clicking it does not blur the editor.
The `Selection` extension is enabled for the same reason from the other side: the `<select>`s and
the link popover do take focus, and without it the user's selection visibly disappears while they
choose a font.

**Text colour and highlight are `ColorMenu`s, opened by a click.** They used to be swatch rows
shown on hover, 4px below the button: crossing that gap left both hover areas, so the row vanished
before the pointer reached it, and clicking the button itself *cleared* the colour. Now the button
opens and closes the menu and shows the current colour as a bar under its icon. The menu stays open
until a colour is chosen, the pointer is pressed outside, or Escape — and when a mouse leaves it,
it waits `COLOR_MENU_CLOSE_DELAY_MS` (400 ms) before closing, cancelled by coming back, and never
closes while focus is inside it. That last rule is what keeps it open while the browser's own
colour picker is up: the native `<input type="color">` holds focus for as long as its dialog does.
Each menu starts with a clear row ("Default colour", "No highlight") and marks the current colour
with `aria-pressed`. Text colour offers a 10 × 4 palette — greys, then light, medium and dark
tones of ten hues — and **Custom colour…**, the native picker, applied on `change` (when the
picker commits) rather than `input`, so dragging through it does not write a transaction per step
into the document's log. Highlight offers 18 light tones and uses `setHighlight`, not
`toggleHighlight`: from a palette, choosing the colour already applied must keep it, not remove it.
The palettes are `TEXT_COLORS` and `HIGHLIGHT_COLORS` in
[`lib/document-styles`](../../lib/document-styles/README.md); in the mobile dock the menus are
`data-popover`, so they open above the dock like the others.

**The table button only creates tables.** `TableMenu` opens on the same click behaviour as the
colour menus — both use `useToolMenu`: open on click, close on a choice, an outside press or
Escape, and after a 400 ms grace when a mouse leaves, never while focus is inside. It offers an
8 × 10 grid to pick the size by pointing, or typed rows and columns (up to 100 × 20), and a
header-row option; a new table takes the text width. **Everything done to an existing table is in
the right-click menu** below — the button no longer changes meaning when the caret is in a table.
Columns are sized by dragging their borders or by the menu's **Fit to text width** and
**Distribute columns evenly**; widths are cells' `colwidth` in pixels, written on every cell of the
column (`withColumnWidths` in `tableWidths.ts`), with the arithmetic in
[`lib/document-tables`](../../lib/document-tables/README.md). A column whose width was never set is
measured from the rendered first row (`offsetWidth`, a layout value, so the mobile page scale does
not distort it).

**A table never grows past the text** — the A4 text width in page view, the text column in
continuous view. Two parts make that true:

- **Dragging is this module's, not the table extension's.** Its `resizable` is off — its column
  resizing has no maximum, so every drag added width — and `ColumnResizing` (in `tableColumns.ts`)
  replaces it, on the same pattern as rows: a `col-resize` cursor and a highlighted border within
  5px of a cell's right edge, a drag previewed by writing the `colgroup` (outside the table's
  `contentDOM`, which the table view tells ProseMirror to ignore), one transaction on release.
  `dragColumnBorder` decides the widths: an **inner** border moves width between its two
  neighbours and the table keeps its width, as in a word processor; the **last** border grows or
  shrinks the table, never past `view.dom.clientWidth`. A drag starts from the widths fitted to the
  text, so editing a table that was too wide brings it in.
- **Display fits what is stored.** `FittedTableView` extends the extension's `TableView` (passed
  as its `View`, which it still uses when `resizable` is off): after the columns are laid out in
  pixels it turns them into percentages of the total and gives the table `max-width: 100%`. A
  table stored wider than the text — pasted, made before this rule, or simply shown in a narrower
  continuous column — is drawn in proportion inside the text width, with nothing changed in the
  document and no horizontal scroll. Its stored widths are fitted for real the next time it is
  resized or fitted.

**Rows can be resized with the pointer too.** The table extension resizes columns only, so rows
are this module's: `SizedTableRow` (in `tableRows.ts`) replaces TipTap's `tableRow` with one that
carries a `height` in pixels, rendered as the row's `style` and read back from a pasted row's
`height` — both through `safeRowHeight`, the same guard pattern as `lib/document-styles`, so a
pasted `height: url(…)` or a second declaration never reaches the document. A height is a
**minimum**, as it is for a table row in CSS: content taller than it still grows the row.
`RowResizing` is the pointer: within 5px of a cell's bottom border the editor shows a `row-resize`
cursor and the row's bottom edge turns brand-coloured; pressing there starts a drag, and on release
the height is written in one transaction — so a drag is one undo step and one delta, not one per
pixel. **Everything it shows is ProseMirror's to draw.** The hovered row and the drag live in the
plugin's state, changed by meta-only transactions kept out of the history; the cursor is a class
from the plugin's `attributes` prop and the highlight and the live height are a node decoration on
the row (`zekke-row-resize-target`, an inset `box-shadow` so the layout does not move). The first
version set the row's `style` and the editor's class by hand, and ProseMirror — which observes its
own DOM and restores what it did not write — undid both, so the drag worked but showed nothing. The pointer distance is divided by `--page-scale`, so a drag on a
phone's scaled page moves the border with the finger. Mouse only: on touch, the border is too thin
a target.

**A table is selectable as a whole.** `TableHandle` draws a grip at the top-left corner of the
table under the pointer, in the page's left margin, hiding 300 ms after the pointer leaves both.
A click selects the table as a single ProseMirror node (`NodeSelection`, outlined in brand
colour) — which needs the table extension's `allowTableNodeSelection`; without it the tables plugin
quietly turns a table node selection into a selection of all its cells, which has no outline and
nothing for a drag to carry — so the editor's own keys apply to all of it: copy, cut, and Delete or Backspace to remove
it. Dragging the grip moves it: on `dragstart` the table is selected, serialised for the drag with
`view.serializeForClipboard`, and handed to ProseMirror as `view.dragging` with `move: true`, so
ProseMirror's own drop handling inserts it where it lands and deletes the original — one
transaction. The grip is a plugin view element positioned against `.zekke-page-body` (now
`position: relative`), with the same scale correction as the rulers. The right-click menu has
**Select table**, the same `selectTable` command.

**Cells can be filled.** The toolbar's third `ColorMenu`, **Cell colour**, is enabled only inside
a table and applies TipTap's `setCellAttribute('backgroundColor', …)` — prosemirror-tables'
`setCellAttr` — to every cell of a cell selection (drag across cells, or Shift-click) or, without
one, to the cell holding the caret; **No fill** sets it back to `null`. It offers the text colour
palette and the custom picker. `ColouredTableCell` and `ColouredTableHeader` (in `tableRows.ts`)
replace TipTap's cell and header with ones carrying `backgroundColor`, read from and written to the
cell's `style` through `safeColor`, so a pasted `background-color: url(…)` stores nothing. Cells set
`print-color-adjust: exact`, because browsers drop background colours when printing unless told
otherwise, and a fill is content.

**Right-clicking a table cell opens `TableContextMenu`, which holds every table action**: rows
(insert above or below, delete), columns (insert left or right, delete), size (**Fit to text
width** scales the columns to the editor's width in proportion; **Distribute columns evenly** keeps
the table's width and evens the columns), and the table (toggle the header row, select it, delete
it). Each item is an entry in `GROUPS` with its own `enabled` and `run`. It listens for `contextmenu` on the editor's DOM and
takes over only inside a `td`/`th` of an editable document; anywhere else the browser's own menu
is untouched. Before opening it moves the caret into the clicked cell (`focusCell` in
`tableWidths.ts`) so the commands act on the cell under the pointer, not on wherever the caret was
— unless a selection of several cells already includes it, which is kept so **Delete row** takes
every selected row. It is a `role="menu"` at the pointer, kept inside the viewport by
`placeMenuAt` ([`lib/app`](../../lib/app/menu-position.ts)): measured hidden first, then placed,
flipping left or up near an edge. The first enabled item takes focus on the next tick — the right
click's own events would otherwise take it back to the editor; a `setTimeout`, not a frame,
because a frame never comes in a background tab. Arrow keys move between items, Escape closes and
returns to the editor, and a press outside, a scroll or a resize closes it. Items `can()` refuse —
deleting the only column, say — are disabled.

Link editing is an in-toolbar popover rather than `window.prompt`, which blocks the page, cannot be
styled, and had no way to edit an existing href. `extendMarkRange('link')` is what lets it work
from a bare caret inside a link. URL validation belongs to the Link extension's `isAllowedUri`
allowlist, not here.

The paragraph-style control calls `setHeading`, not `toggleHeading`: from a `<select>`, choosing
the level that is already active must be a no-op, and toggle turns it back into a paragraph while
the select still reads "Heading 2".

**The toolbar's values live in [`lib/document-styles`](../../lib/document-styles/README.md)**, not here,
because they double as the allowlist. `extensions.ts` swaps TipTap's `Color`, `FontFamily`,
`FontSize`, `LineHeight` and `Highlight` attribute definitions for guarded ones built from the same
lists, so a pasted `style` or `data-color` can store only a value the toolbar could have set — or,
for colours, a plain colour. That module explains the injection it closes.

`FONT_FAMILIES` names `var(--font-sans)` and `var(--font-mono)` — the properties this app actually
defines in `globals.css` — and one `var(--font-doc-*)` per Google font. They previously named
`--font-geist-*`, which exist in the Next.js starter template and not here, so two of the three
font options silently did nothing. Any export has to map these tokens to real family names
explicitly.

**The Google fonts are loaded by [`fonts.ts`](./fonts.ts)**, self-hosted through
`next/font/google`. `DOCUMENT_FONT_VARIABLES` is the class list that defines every
`--font-doc-*` property, and `DocumentWorkspace` puts it on its `<main>`, so the properties exist
for the editor, the toolbar and print alike — and nowhere else in the app. Why they are
self-hosted and lazily fetched is in
[`lib/document-styles`](../../lib/document-styles/README.md#the-fonts).

The font menu is a native `<select>` with one `<optgroup>` per `FONT_GROUPS` entry, each option
drawn in its own font. The value shown is passed through `safeFontFamily` first, so a family
stored with other quoting still selects its entry. Text with no font of its own shows the
document's **base font** — Arial for a document created now, Inter for an older one.
`DocumentWorkspace` reads it from `meta.font` with `useDocumentBaseFont`, which follows a change
synced from another device, sets it as the `font-family` of the page, and hands it to the
toolbar; `useDocumentSync` gives an untouched document its base font. Why this is per document
is in [`lib/document-styles`](../../lib/document-styles/README.md#the-fonts).

**The font size is a box, not a menu.** Typing a number and pressing Enter applies it, clamped to
8–96; Escape or leaving the box discards the draft rather than applying it, because leaving it by
clicking into the document moves the selection first and would size the wrong text. ArrowUp and
ArrowDown apply the next preset, and the chevron opens the preset list (`FONT_SIZES`). The list
buttons keep focus in the editor with `onMouseDown` `preventDefault`, like the toolbar buttons.

### Images

An image is an attachment of the document ([ADR 00020](../../../../api-general/docs/adr/00020_document_attachments.md));
its key, object, preparation and upload are [`lib/documents/attachments`](../../lib/documents/attachments/README.md).
This module is the editor's half.

**Inserting.** The toolbar's image button opens a hidden file input; an image can also be dropped
on the sheet or pasted as bytes (a screenshot, a file copied from the desktop) — the node's plugin
takes `handlePaste` and `handleDrop` only when files are images. `DocumentImageHost.insertFiles`
prepares each image, refuses one too large or not an image with a notice at the bottom of the
screen, writes the two attachment entries into the `Y.Doc`, shows the prepared image at once from a
local `blob:` URL, inserts the node, and uploads in the background. A failed upload stays in the
text with its message and a **Retry**, which uses the same ids and keys. **Nothing is fetched from
a URL**: the node parses only `img[data-attachment]`, so a pasted `<img src="https://…">` is
dropped — the Content Security Policy's `img-src 'self' blob: data:` would block it anyway.

**The node.** `image` is a block atom: `attachment` (the id — never the key, so the clipboard's HTML
carries none), `width` and `height` (the prepared image's, so the frame has its aspect ratio and
pagination measures the right height before anything loads), `share` (its width as a fraction of
the text width, 0.05 to 1), `align` (`left`, `center`, `right`) and `alt`. Every attribute goes
through a guard in `placement.ts` on the way in and out, the pattern of `lib/document-styles`. The
width being a share is what keeps an image's proportion in page view, in a narrower continuous
column, under the mobile page scale and in print, and what stops it ever being wider than the text.
A new image starts at the width it was prepared for — half its pixel width, on a 2× screen — capped
at the text width.

**The view** (`ImageNodeView`, plain DOM) draws a frame with the image's aspect ratio and fills it
when the image is near the screen (an `IntersectionObserver`, 800 px ahead). Its states, each with
words rather than a broken image: loading; uploading (a small pill over the image); upload failed,
with **Retry**; not available yet — another device's upload not finished, or abandoned — with
**Try again**; and *came from another document*. Selecting it outlines it and shows two **resize
handles** and a small toolbar: left, centre, right, and the **alternative text** field (an input
with `PRIVATE_TEXT_ATTRIBUTES`). A handle previews the width as the pointer moves and writes one
transaction on release; a centred image grows from both sides, so it moves twice the pointer
(`resizedImageShare`). **Moving** is ProseMirror's own drag of a draggable node: drag the image to
another place in the text. Text does not flow around an image; it is a block.

**Pasting an image from another document** brings its node and id, and no key. The view asks
`adoptForeign`: if this tab opened that image while the other document was open, its decrypted
bytes are remembered, and the host prepares and uploads it again under a new id and key and
rewrites every node that named the old one. Otherwise the node says to insert it again.

**Printing waits for the images.** The print button calls `printDocument`, which opens every image
still waiting below the screen before `window.print()`. The browser's own Ctrl+P cannot be waited
for: an image not yet loaded prints as blank space of its size, never as a placeholder's text.

**One host per open document.** `DocumentSurface` builds it once, hands it to the extension set
(`documentExtensions(doc, { images })`) and gives it the editor in an effect. Unmounting revokes
every `blob:` URL; the host survives React's development double mount because opening again
re-arms it.

### First pages on the Documents screen

A document's tile draws its **first page**: what `readFirstPage` kept of the beginning of the body
([`lib/documents`](../../lib/documents/README.md#images-are-attachments-and-compaction-reports-them)),
rendered by `DocumentMiniature` with the editor's own schema — `getSchema(documentExtensions(…))`,
`PMNode.fromJSON` and ProseMirror's `DOMSerializer`, so every node and mark goes through the same
`renderHTML` and the same style guards as in the editor, and nothing is ever assigned as HTML. The
sheet is an A4 page at full size — `PAGE_WIDTH_PX` wide, the document's margins as padding, its
base font, `zekke-prose` — scaled down to the tile with a `transform`, so headings, sizes, colours,
highlights, alignment, lists and tables with their column widths and cell fills come out as they
are in the editor, clipped at the page's height. A document without content is a blank page.

Images use their **thumbnails**, never the originals: fetched only once the tile is within 200 px
of the screen, decrypted with the key the summary carried out of the document, and cached as
`blob:` URLs for the rest of the session. A document without images costs no request beyond the
ones the list already makes. The tile renders nothing at all until it is near the screen.

