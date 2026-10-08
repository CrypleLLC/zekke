# `tools/function-names` — Excel's function names, per language, from Microsoft's own articles

The tables in [`src/lib/spreadsheets/function-names`](../../src/lib/spreadsheets/function-names/README.md)
say what each function Univer implements is called in Excel in a given language — `SUM` is `SOMA`
in Brazilian Portuguese, `SUMME` in German. **Nothing in them comes from memory**: every name is
read from Microsoft's localized support article for that function, and every name that needed a
judgement says why in `overrides/<language>.json`.

| File | Role |
| --- | --- |
| `fetch.py <cache>` | Downloads the English index and every function's article in the seven languages, politely (one request every 1.5 s, backing off on a refusal). Resumes from the cache |
| `extract.py <cache> names.json` | Reduces the articles to what is needed: per article and language, the names in the syntax section, in the whole article, in the example formulas, and how often each appears, without the site's boilerplate |
| `names.json` | That extract, kept in the repository so the tables can be rebuilt without downloading again |
| `build.py` | Builds each language's table from `names.json` and `overrides/`, restricted to the functions Univer implements, and writes it **only when it is complete** |
| `overrides/<language>.json` | Every reviewed decision: the name and the evidence for it |
| `provenance/<language>.json` | For each name, how it was obtained |
| `report.json` | Per language: what is missing, what clashes, and what is still flagged for review |
| `not-excel.json` | Functions Univer implements that are not Excel's (Google Sheets' and Univer's own): they keep their English names in every language |

The raw pages (`cache/`, about 700 MB, and `en.html`) are not kept.

## How a name is chosen

1. **The index.** Microsoft's English "Excel functions (alphabetical)" page links each function
   to its article. The article's path is the same in every language
   (`support.microsoft.com/<language>/excel/functions/<slug>`).
2. **The syntax section** (`<h2 id="syntax">`) names the function as it is typed. Where the
   English and the localized syntax name the same number of functions, they are paired in order;
   otherwise the first name of each is paired.
3. **Fallbacks, always flagged**: the article's names in order (for articles without a syntax
   heading), the first name in the article, another article naming the function at the same
   position, and `<base name>B` for the byte variants (`LEFTB` beside `LEFT`).
4. **The examples confirm it.** Where the localized article has example formulas, the chosen name
   must appear in them; otherwise the function is flagged with the names the examples do use.
5. **Checks that refuse to write a table**: a name missing, two functions with one name, a name
   that is a fragment of the English one (`MATH` for `CEILING.MATH`, from a syntax line split by
   markup), an `IS` function keeping its English stem (`ESODD`), and any flag not yet reviewed.

## What a review decides

Microsoft's articles are not uniformly reliable, and the review exists because of it:

- **A syntax line left in English** while the article uses the translated name elsewhere
  (`HYPERLINK`, written `HIPERLINK` in the Portuguese text).
- **A syntax line machine-translated** rather than written in Excel's names (`DE TECHO. MATH` in
  Spanish for `MULTIPLO.SUPERIOR.MAT`).
- **Names that really are the same** as in English (`ACOS`, `PEARSON`).
- **Retired articles**: Microsoft retired `FIND`/`FINDB`'s, and no other article names them.

**When Microsoft's text does not establish a name, the function keeps its English name**, and the
override says so. A name typed in English always works, so that costs a familiar word, never a
wrong formula.
