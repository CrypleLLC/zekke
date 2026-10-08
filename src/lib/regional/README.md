# `lib/regional` — how a person writes dates, numbers and money

The regional model, at two levels. Framework-free and unit-tested.

- **The account** (`RegionalPreferences`): a country and the five formats it implies — date, time,
  number, units, paper — each of which the person may change on its own. They apply across the
  app and are the defaults for new documents and spreadsheets. Stored sealed on the account by
  [`lib/preferences`](../preferences/README.md); set in **Settings → Region**
  ([`components/settings`](../../components/settings/README.md)).
- **A spreadsheet** (`SpreadsheetRegional`): its own country, date, time, number, currency and
  function language. Stored inside the spreadsheet's document, so everyone who opens it reads it
  the same way ([`lib/spreadsheets`](../spreadsheets/README.md#regional-settings)); set in the
  spreadsheet's **Settings** menu ([`components/spreadsheets`](../../components/spreadsheets/README.md#the-screen)).

Currency and function names belong to a spreadsheet only: nothing else in the app writes money or
formulas. Units and paper belong to the account only: a spreadsheet prints on the account's paper.

| Export | What it is |
| --- | --- |
| `RegionalPreferences` | The account's: `country`, `date`, `time`, `number`, `measurement`, `paper` |
| `SpreadsheetRegional` | A spreadsheet's: `country`, `date`, `time`, `number`, `currency`, `functions` |
| `DATE_FORMATS`, `TIME_FORMATS`, `NUMBER_FORMATS`, `MEASUREMENT_SYSTEMS`, `PAPER_CHOICES`, `FUNCTION_LANGUAGES` | The choices, as closed lists |
| `NUMBER_SEPARATORS` | Each number format's decimal sign, group separator and whether it groups in lakhs |
| `countryDefaults(country)` | What a country uses, at account level |
| `differsFromCountry(preferences)` | Which account formats the person changed from their country's |
| `parseRegionalPreferences(value, fallbackCountry)` | The guard for what was stored: anything unreadable is the country's default |
| `spreadsheetDefaults(account)` | What a new spreadsheet starts with: the account's country and formats, that country's currency and function language |
| `spreadsheetCountryDefaults(country, functions)` | What a country uses in a spreadsheet, with the given function language |
| `withSpreadsheetCountry(regional, country)` | A newly chosen country's spreadsheet formats, keeping the function language |
| `spreadsheetDiffersFromCountry(regional)` | Which spreadsheet formats differ from its country's |
| `parseSpreadsheetRegional(value, fallback)` | The guard for what a spreadsheet stored |
| `functionLanguageFor(country)` | The function language of a country's language, when a table exists; English otherwise |
| `countryFromLocale`, `browserCountry` | The country of a language tag, or of this browser; the US when there is none |
| `countryName`, `currencyName`, `countryCodes`, `currencyCodes` | Names in English through `Intl.DisplayNames`, and the lists |
| `formatPlainNumber`, `formatDatePattern`, `formatTimePattern`, `argumentSeparator` | Writing a value with a preference |

## Dates and counts across the app

`active.ts` holds the session's preferences for formatting that happens during render:
`regionalDate`, `regionalShortDate` (the pattern without its year, for this year's dates in
listings), `regionalTime`, `regionalDateTime` and `regionalCount`, all in local time. Until the
preferences load they are the browser country's defaults. `RegionalScope`, around the ready phase in
`SessionGate`, keeps them current; a screen picks up a change the next time it renders. Every date,
time and count the app draws goes through them rather than the browser's locale.

## Where the defaults come from

**CLDR, through `Intl`**, not a table of ours, except for what `Intl` does not say:

- **The country's language** is `Intl.Locale('und-<country>').maximize()`'s language, written as
  `<language>-<country>` **without the script** — ICU drops the region when a script subtag is
  present (`en-Latn-GB` formats as `en`, US style), which the tests caught.
- **Date order and separator** from `Intl.DateTimeFormat` with two-digit day and month, mapped to
  the closest of `DATE_FORMATS`. **Hour cycle** from `resolvedOptions().hourCycle`.
- **Number separators** from `Intl.NumberFormat` in Latin digits: a space-like group (NBSP or
  narrow NBSP) is `space-*`, an apostrophe `apostrophe-dot`, a comma decimal `dot-comma`, and
  2-2-3 grouping `indian`. Arabic separators map to their Latin counterparts.
- **Currency**: `COUNTRY_CURRENCIES` in `countries.ts`, ISO 4217 by ISO 3166 country (Bulgaria on
  the euro since 2026, Curaçao and Sint Maarten on `XCG`, Zimbabwe on `ZWG`). Uninhabited
  territories are left out.
- **Units**: imperial in the US, Liberia and Myanmar; metric everywhere else.
- **Paper**: Letter in the Americas' Letter countries and the Philippines; A4 everywhere else.

The tests pin twelve countries by hand and check that every one of the 244 has a name, a currency
`Intl` knows, and readable defaults.

## The function language

`functions` is not a regional format: choosing a country in a spreadsheet's settings leaves it
alone. It offers English and the languages whose function names have a complete, reviewed table —
Brazilian and European Portuguese, Spanish, French and German
([`lib/spreadsheets/function-names`](../spreadsheets/function-names/README.md)).

**A new spreadsheet starts in its country's function language** (`functionLanguageFor`): Brazil in
Brazilian Portuguese, every other Portuguese-speaking country in European Portuguese, a Spanish-,
French- or German-speaking country in that language, and English for every country whose language
has no table (Italy among them). The country's language is CLDR's, so Canada is English and
Switzerland German.
