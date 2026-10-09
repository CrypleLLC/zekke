# `lib/spreadsheets/function-names` — Excel's function names, per language

One table per language, `{ "<English name>": "<name in that language>" }`, for every Excel function
Univer implements (491). `functionNamesFor(language)` builds the two-way map
[`formula-locale.ts`](../formula-locale.ts) uses to show and read formulas in the person's
language ([A formula in the person's syntax](../README.md#a-formula-in-the-persons-syntax)).

| Language | File |
| --- | --- |
| Português (Brasil) | `pt-BR.json` |
| Português (Portugal) | `pt-PT.json` |
| Español | `es.json` |
| Français | `fr.json` |
| Deutsch | `de.json` |

**The names are Excel's, as Microsoft documents them in each language**, built and reviewed by
[`tools/function-names`](../../../../tools/function-names/README.md): every name comes from
Microsoft's localized articles, and every judgement is written down with its evidence. **Do not edit
these files by hand**; change an override there and rebuild.

- **A name Microsoft's text does not establish stays English**: retired articles (`FIND`, `FINDB`),
  untranslated articles, and names only Microsoft's machine-translated index gives. A name typed
  in English always works, so this costs a familiar word, never a wrong formula. The report lists
  them per language.
- **Italian is not here.** Microsoft's Italian articles give two competing sets of names for the
  same functions (`PAGAM` and `RATA` for `PMT`, `MATR.TRASPOSTA` and `TRASPONI` for `TRANSPOSE`),
  consistent with a renaming between Excel versions; which one Italian users see could not be
  settled from Microsoft's text, so the language is not offered.
- **Three names are another function's English name, as in Excel**: Spanish `FIXED` is `DECIMAL`,
  French `MIRR` is `TRIM` and `VARP` is `VAR.P`. In those languages the localized meaning wins;
  `function-names.test.ts` pins the list, so a new one fails until it is reviewed.
- Functions Univer implements that are not Excel's (Google Sheets' and Univer's own) keep their
  English names everywhere.

`function-names.test.ts` checks each table: the same functions in every language, one well-formed
name per function, no two functions sharing one, and a formula using every function translated
there and back.
