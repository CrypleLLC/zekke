import type { PaperSize } from "@/lib/document-page";
import {
  countryName,
  currencyName,
  formatDatePattern,
  formatPlainNumber,
  formatTimePattern,
  type CountryField,
  type SpreadsheetCountryField,
  type SpreadsheetRegional,
  type DateFormat,
  type FunctionLanguage,
  type MeasurementSystem,
  type NumberFormat,
  type RegionalPreferences,
  type TimeFormat,
} from "@/lib/regional";

export const SPREADSHEET_SETTINGS_COPY = {
  open: "Settings",
  title: "Spreadsheet settings",
  subtitle:
    "Formats and function names for this spreadsheet only. Everyone who opens it sees the same; your account's formats stay as they are.",
  formatsTitle: "Region and formats",
  formatsSummary:
    "How dates, times, numbers and money are written and typed in this spreadsheet. Choosing a country sets all of them; you can then change any one.",
  restoreAccount: "Use my account's formats",
  saved: "Saved in this spreadsheet. It is encrypted with the spreadsheet, like its cells.",
} as const;

export const REGION_COPY = {
  title: "Region and formats",
  summary:
    "How dates, times and numbers are written across Zekke, and which units and paper you use. New documents and spreadsheets start with these; each spreadsheet can then use its own. Choosing a country sets all of them; you can then change any one.",
  country: "Country or region",
  date: "Date",
  time: "Time",
  number: "Numbers",
  currency: "Currency",
  measurement: "Units",
  paper: "Paper",
  restoreDefaults: (country: string) => `Use the formats of ${country}`,
  saved: "Saved. Your other devices pick this up the next time they open.",
  sealed: "Stored encrypted with your account: Zekke cannot see which country or formats you chose.",
} as const;

export const FUNCTION_LANGUAGE_LABELS: Record<FunctionLanguage, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
  "pt-PT": "Português (Portugal)",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
};

export const FUNCTION_LANGUAGE_COPY = {
  title: "Spreadsheet function names",
  summary:
    "The language this spreadsheet's function names are typed and read in, as Excel names them in that language — SOMA, PROCV and SE in Portuguese. The formulas are stored the same way whatever you choose, and a name typed in English always works.",
  label: "Function names",
} as const;

export const MEASUREMENT_LABELS: Record<MeasurementSystem, string> = {
  metric: "Metric (cm, kg)",
  imperial: "Imperial (in, lb)",
};

export const REGION_PAPER_LABELS: Record<PaperSize, string> = {
  a4: "A4",
  letter: "Letter",
};

const EXAMPLE_DATE = new Date(Date.UTC(2026, 9, 27));

export function dateFormatLabel(format: DateFormat): string {
  return `${formatDatePattern(EXAMPLE_DATE, format)}  (${format.toUpperCase().replace(/Y{4}/, "YYYY")})`;
}

export function timeFormatLabel(format: TimeFormat): string {
  return `${formatTimePattern(13, 45, format)}  (${format === "24h" ? "24-hour" : "12-hour"})`;
}

export function numberFormatLabel(format: NumberFormat): string {
  return formatPlainNumber(1234567.89, format);
}

export function currencyLabel(currency: string): string {
  const name = currencyName(currency);
  return name === currency ? currency : `${currency} — ${name}`;
}

type RegionalField = CountryField | SpreadsheetCountryField;
type RegionalValues = Partial<RegionalPreferences & SpreadsheetRegional> & { country: string };

export function countryDefaultHint<Values extends RegionalValues>(
  field: RegionalField & keyof Values,
  preferences: Values,
  defaults: Values,
): string | undefined {
  if (preferences[field] === defaults[field]) {
    return undefined;
  }
  return `${countryName(preferences.country)} uses ${defaultValueLabel(field, defaults)}.`;
}

function defaultValueLabel(field: RegionalField, defaults: RegionalValues): string {
  switch (field) {
    case "date":
      return formatDatePattern(EXAMPLE_DATE, defaults.date ?? "yyyy-mm-dd");
    case "time":
      return formatTimePattern(13, 45, defaults.time ?? "24h");
    case "number":
      return numberFormatLabel(defaults.number ?? "comma-dot");
    case "currency":
      return defaults.currency ?? "";
    case "measurement":
      return MEASUREMENT_LABELS[defaults.measurement ?? "metric"];
    case "paper":
      return REGION_PAPER_LABELS[defaults.paper ?? "a4"];
  }
}
