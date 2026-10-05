# `lib/document-styles`

The formatting values the document editor may hold, and the guards that stop anything else from
getting into a style attribute. Framework-free, so every guard is unit-tested in node;
[`components/documents/extensions.ts`](../../components/documents/extensions.ts) plugs them into
TipTap.

| Export | What it is |
| --- | --- |
| `FONT_FAMILIES`, `FONT_GROUPS`, `LINE_HEIGHTS` | What the toolbar offers, and what the guards accept |
| `TEXT_COLORS`, `TEXT_COLOR_COLUMNS`, `HIGHLIGHT_COLORS` | The colour menus' palettes: 40 text colours in rows of 10, 18 highlights. Colours are a grammar, not a list, so these are only what is offered; any safe colour is kept |
| `pickerColor(value, fallback)` | A colour in the one format `<input type="color">` accepts, `#rrggbb` lowercase — `#abc` expanded, anything else the fallback |
| `FONT_SIZES`, `FONT_SIZE_MIN_PX`, `FONT_SIZE_MAX_PX` | The size presets in the toolbar's list, and the range a typed size may take |
| `safeColor`, `safeFontFamily`, `safeFontSize`, `safeLineHeight` | A value in, the value or `undefined` out |
| `fontSizeFromInput(text)` | What a person typed in the size box → a size in range, or `undefined` |
| `stepFontSize(size, direction)` | The next preset up or down, for the arrow keys in the size box |
| `fontSizePixels(size)` | `'14px'` → `14` |
| `DEFAULT_DOCUMENT_FONT`, `LEGACY_DOCUMENT_FONT`, `documentBaseFont(stored)` | The base font a new document starts in (Arial), the one older documents keep (Inter), and the guard for the stored value |
| `styleAttribute(name, property, sanitize)` | A TipTap attribute spec that sanitises on parse **and** on render |
| `highlightColorAttribute()` | The same for the multicolor highlight, which also writes `data-color` |
| `styleDeclaration(style, property)` | One declaration out of a raw `style` string — a port of TipTap's own reader |

## What this defends against

TipTap's `Color`, `FontFamily`, `FontSize`, `LineHeight` and multicolor `Highlight` read a value
from pasted HTML and write it back into a `style` attribute by interpolation —
`background-color: ${color}`. Nothing checks the value.

**Reproduced on 2026-09-13 against `@tiptap/extension-highlight@3.31.3`** by calling its own
attribute spec with a pasted element. `data-color` is read raw, not split on `;`:

```
parseHTML  <mark data-color="red; background-image: url(https://tracker.example/opened)">
           → "red; background-image: url(https://tracker.example/opened)"
renderHTML → style="background-color: red; background-image: url(https://tracker.example/opened); color: inherit"
```

Stored in the document, that is a **beacon**: a request to someone else's server every time the
document is opened, on every device, carrying the time and the IP. CSS alone cannot read the
document's text, which is why this is low severity rather than a leak of content. The `style`
readers for the other four split on `;` first, so a paste cannot reach them the same way. Their
`renderHTML` interpolates whatever the document holds, though, so they are guarded too.

The Content Security Policy's `img-src` blocks the request as well
([`lib/security-headers`](../security-headers/README.md)). This is the layer that keeps the value out
of the document in the first place.

## The rules

- **Colours are a grammar, not a list.** Pasting from another editor should keep its colours, so
  `safeColor` accepts:
  - hex: 3, 4, 6 or 8 digits;
  - `rgb()` / `rgba()` / `hsl()` / `hsla()` whose arguments are only numbers, `%` or `deg`;
  - a bare alphabetic keyword.

  None of those can hold `;`, `(` beyond the one function, `:`, a quote, a backslash escape or a
  comment, so none can end the declaration or start `url(`.
- **Family and line height are lists.** Only what the toolbar can set survives. A family is
  compared with quotes and whitespace removed, so `Georgia,'Times New Roman',serif` maps to the
  toolbar's own spelling.
- **Size is a range.** The size box is typed, so any whole number of pixels from 8 to 96 is a size
  the toolbar can set: `safeFontSize` accepts `^[1-9]\d{0,2}px$` inside that range and nothing
  else — no other unit, no fraction, no leading zero, so each size has one spelling.
  `fontSizeFromInput` is the lenient side, for the box only: it takes `14`, `14px`, `13.6` or
  `10,4`, rounds, and clamps `3` to 8 and `400` to 96. What it returns always passes
  `safeFontSize`.
- **Every value is capped at 64 characters** before any other check.
- **Sanitised twice.** `parseHTML` stops a paste from storing the value. `renderHTML` refuses a bad
  value that is already in the document — from before this guard, or from a Yjs update that did not
  come through the editor.

**What the lists cost.** A paste from Google Docs or Word loses its font, its `11pt` sizes and its
`1.15` line spacing; the text arrives in the document's defaults. That is deliberate: a value the
editor cannot show in its own toolbar is one the user cannot see or change. A pasted size in whole
pixels within 8–96 is kept.

## The fonts

`FONT_FAMILIES` is grouped by `FONT_GROUPS` (classic, sans serif, serif, monospace, display) and
holds four kinds of value:

- **the classic three, first:** `Arial, var(--font-doc-arimo), sans-serif`,
  `"Times New Roman", var(--font-doc-tinos), serif` and
  `"Courier New", var(--font-doc-cousine), monospace`. Arial, Times New Roman and Courier New are
  Monotype's and cannot be served from here; where the system has them (Windows, macOS) the
  browser uses them. Elsewhere it falls through to Arimo, Tinos and Cousine — Apache-licensed
  Google fonts drawn to the **same metrics**, so every line breaks in the same place either way;

- `var(--font-sans)` and `var(--font-mono)` — Inter and JetBrains Mono, the app's own fonts,
  loaded in `app/layout.tsx`;
- `Georgia, "Times New Roman", serif` — a system font;
- `var(--font-doc-<name>), <generic>` — the open-source Google fonts, loaded by
  [`components/documents/fonts.ts`](../../components/documents/fonts.ts) with `next/font/google`.

Inter, Georgia and JetBrains Mono are the values documents were written with before the Google
fonts existed, so they stay, or those documents would lose their font on the next render.

**Arial is the default for a new document, and only a new one.** The text with no font of its own
is drawn in the document's base font, stored in the document as `meta.font`
([`lib/documents`](../documents/README.md#the-base-font-lives-inside-the-crdt-too)). A new
document is given `DEFAULT_DOCUMENT_FONT`, the first entry here; a document without the field is
drawn in `LEGACY_DOCUMENT_FONT`, Inter, which is what it was written in. Changing the default is
moving another entry to the top: documents already given Arial keep it.

`next/font` downloads each font **at build time** and serves it from this app's own origin. A
document never makes a request to Google, the Content Security Policy needs no new host, and
which fonts a person uses is not something a third party can see. Each is declared with
`preload: false`: the `@font-face` rules ship with the documents screen, and a browser fetches a
font file only when text on screen uses it.

**Adding a font** is two edits that must agree: an entry here, and a loader call in `fonts.ts`
whose `variable` is the `--font-doc-*` name the entry uses. `next/font` needs literal options, so
the list cannot be generated from here; `components/documents/extensions.test.ts` reads `fonts.ts`
and fails if the two disagree. Prefer a font with a variable axis and an italic, or the bold and
italic marks are synthesised by the browser.

## What is not here, and why

- **`TextAlign`** already checks parsed values against its `alignments` option, and its commands
  refuse anything else.
- **`Link`** validates `href` with its own `isAllowedUri` allowlist.
- **Table column widths** are parsed as integers by TipTap.
