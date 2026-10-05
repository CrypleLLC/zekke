# `lib/document-page`

The page a document is laid out on: A4, and the four margins around its text. Framework-free and
unit-tested; [`components/documents`](../../components/documents/README.md#margins-and-rulers) draws
the rulers and the sheet from it.

| Export | What it is |
| --- | --- |
| `PageMargins`, `MarginSide`, `MARGIN_SIDES` | Four margins in millimetres, and their names in CSS box order |
| `PAGE_WIDTH_MM`, `PAGE_HEIGHT_MM` | A4 |
| `DEFAULT_PAGE_MARGINS` | 3 cm top and left, 2 cm right and bottom — what a new document starts with |
| `LEGACY_PAGE_MARGINS` | 2.54 cm all round — what every document had before margins could be set |
| `pageMargins(stored)` | The guard for `meta.margins`: valid margins, or the legacy ones |
| `moveMargin(margins, side, value)` | One side moved and clamped; the same object when nothing changed |
| `maxMargin`, `MIN_TEXT_MM` | How far a side can go: the page, less 5 cm of text, less the opposite side |
| `snapMargin`, `MARGIN_STEP_MM`, `MARGIN_FINE_STEP_MM`, `MARGIN_LARGE_STEP_MM` | 2.5 mm by default, 0.5 mm fine, 1 cm large |
| `millimetresFromPixels(px)` | CSS pixels to millimetres, at CSS's fixed 96 px per inch |
| `marginLabel(mm)`, `MARGIN_NAMES` | `30` → `3 cm`; the slider names |
| `pageMarginVariables(margins)` | The `--doc-margin-*` properties the sheet reads |
| `printPageRule(margins)` | The `@page` rule a print uses |

## The rules

- **Millimetres, to a tenth.** Every value is rounded to 0.1 mm, so a stored margin has one
  spelling and comparing two is exact. CSS defines `1in = 96px = 25.4mm`, so a millimetre is a
  fixed number of CSS pixels and a drag converts without measuring anything.
- **Always room for text.** A side may go from 0 to the page's extent, less `MIN_TEXT_MM` (5 cm),
  less the opposite side. `moveMargin` clamps to that; `pageMargins` refuses a stored value that
  breaks it.
- **Anything unreadable is the legacy inch.** A document without `meta.margins` was written at
  2.54 cm, and a malformed value — a missing side, a string, a negative, a non-finite number, two
  sides that leave no text — is treated the same, rather than as the new default, so a damaged
  field never silently reflows a document that predates it.
- **`moveMargin` returns its input when nothing moved.** That is what lets the rulers skip the
  write when a drag ends where it started.

## Why the CSS is generated here

`pageMarginVariables` and `printPageRule` interpolate numbers into CSS, so they only ever see the
output of `pageMargins` or `moveMargin` — finite, non-negative numbers rounded to a tenth. Nothing
from a stored document reaches a stylesheet unchecked; the same reasoning as
[`lib/document-styles`](../document-styles/README.md#what-this-defends-against).

The print rule is a `<style>` element rather than a declaration in `globals.css` because `@page`
reads no custom properties — there is no element for it to inherit them from. The Content Security
Policy already allows inline styles (`style-src 'unsafe-inline'`,
[`lib/security-headers`](../security-headers/README.md)).
