import type { PaperSize } from '@/lib/document-page';
import { COUNTRY_CURRENCIES, IMPERIAL_COUNTRIES, LETTER_COUNTRIES } from './countries';

export { COUNTRY_CURRENCIES } from './countries';

export const DATE_FORMATS = [
  'dd/mm/yyyy',
  'mm/dd/yyyy',
  'yyyy-mm-dd',
  'dd.mm.yyyy',
  'dd-mm-yyyy',
  'yyyy/mm/dd',
  'yyyy.mm.dd',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const TIME_FORMATS = ['24h', '12h'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

export const NUMBER_FORMATS = ['comma-dot', 'dot-comma', 'space-comma', 'space-dot', 'apostrophe-dot', 'indian'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export const MEASUREMENT_SYSTEMS = ['metric', 'imperial'] as const;
export type MeasurementSystem = (typeof MEASUREMENT_SYSTEMS)[number];

export const PAPER_CHOICES: readonly PaperSize[] = ['a4', 'letter'];

export const FUNCTION_LANGUAGES = ['en', 'pt-BR', 'pt-PT', 'es', 'fr', 'de'] as const;
export type FunctionLanguage = (typeof FUNCTION_LANGUAGES)[number];

export interface NumberSeparators {
  decimal: string;
  group: string;
  lakh: boolean;
}

export const NUMBER_SEPARATORS: Record<NumberFormat, NumberSeparators> = {
  'comma-dot': { decimal: '.', group: ',', lakh: false },
  'dot-comma': { decimal: ',', group: '.', lakh: false },
  'space-comma': { decimal: ',', group: ' ', lakh: false },
  'space-dot': { decimal: '.', group: ' ', lakh: false },
  'apostrophe-dot': { decimal: '.', group: '’', lakh: false },
  indian: { decimal: '.', group: ',', lakh: true },
};

export interface RegionalPreferences {
  country: string;
  date: DateFormat;
  time: TimeFormat;
  number: NumberFormat;
  measurement: MeasurementSystem;
  paper: PaperSize;
}

export interface SpreadsheetRegional {
  country: string;
  date: DateFormat;
  time: TimeFormat;
  number: NumberFormat;
  currency: string;
  functions: FunctionLanguage;
}

export const COUNTRY_FIELDS = ['date', 'time', 'number', 'measurement', 'paper'] as const;
export type CountryField = (typeof COUNTRY_FIELDS)[number];

export const SPREADSHEET_COUNTRY_FIELDS = ['date', 'time', 'number', 'currency'] as const;
export type SpreadsheetCountryField = (typeof SPREADSHEET_COUNTRY_FIELDS)[number];

export const FALLBACK_COUNTRY = 'US';
const CURRENCY_CODE = /^[A-Z]{3}$/;

export function countryCodes(): string[] {
  return Object.keys(COUNTRY_CURRENCIES);
}

export function isCountry(value: unknown): value is string {
  return typeof value === 'string' && Object.hasOwn(COUNTRY_CURRENCIES, value);
}

export function countryLocale(country: string): string {
  try {
    return `${new Intl.Locale(`und-${country}`).maximize().language}-${country}`;
  } catch {
    return 'en-US';
  }
}

export function countryName(country: string, displayLocale = 'en'): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'region' }).of(country) ?? country;
  } catch {
    return country;
  }
}

export function currencyName(currency: string, displayLocale = 'en'): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'currency' }).of(currency) ?? currency;
  } catch {
    return currency;
  }
}

export function currencyCodes(): string[] {
  const listed = new Set(Object.values(COUNTRY_CURRENCIES));
  try {
    for (const code of Intl.supportedValuesOf('currency')) {
      listed.add(code);
    }
  } catch {
    return [...listed].sort();
  }
  return [...listed].sort();
}

const SAMPLE_DATE = new Date(Date.UTC(2026, 9, 27, 12));

export function localeDateFormat(locale: string): DateFormat {
  const parts = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).formatToParts(SAMPLE_DATE);
  const order = parts
    .filter((part) => part.type === 'year' || part.type === 'month' || part.type === 'day')
    .map((part) => part.type[0])
    .join('');
  const separator = parts.find((part) => part.type === 'literal')?.value.replace(/[^/.\-]/g, '').charAt(0) ?? '';
  const year = order.startsWith('y');
  const pattern =
    order === 'ymd'
      ? `yyyy${separator || '-'}mm${separator || '-'}dd`
      : order === 'mdy'
        ? `mm${separator || '/'}dd${separator || '/'}yyyy`
        : `dd${separator || '/'}mm${separator || '/'}yyyy`;
  if ((DATE_FORMATS as readonly string[]).includes(pattern)) {
    return pattern as DateFormat;
  }
  return year ? 'yyyy-mm-dd' : order === 'mdy' ? 'mm/dd/yyyy' : 'dd/mm/yyyy';
}

export function localeTimeFormat(locale: string): TimeFormat {
  const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h11' || cycle === 'h12' ? '12h' : '24h';
}

export function localeNumberFormat(locale: string): NumberFormat {
  const parts = new Intl.NumberFormat(locale, { numberingSystem: 'latn' }).formatToParts(1234567.89);
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';
  const group = parts.find((part) => part.type === 'group')?.value ?? ',';
  const integers = parts.filter((part) => part.type === 'integer').map((part) => part.value.length);
  const comma = decimal === ',' || decimal === '٫';
  if (/[\s  ]/.test(group)) {
    return comma ? 'space-comma' : 'space-dot';
  }
  if (group === '’' || group === "'") {
    return 'apostrophe-dot';
  }
  if (comma) {
    return 'dot-comma';
  }
  return integers.length === 3 && integers[0] === 2 && integers[1] === 2 ? 'indian' : 'comma-dot';
}

export function countryDefaults(country: string): RegionalPreferences {
  const code = isCountry(country) ? country : FALLBACK_COUNTRY;
  const locale = countryLocale(code);
  return {
    country: code,
    date: localeDateFormat(locale),
    time: localeTimeFormat(locale),
    number: localeNumberFormat(locale),
    measurement: IMPERIAL_COUNTRIES.has(code) ? 'imperial' : 'metric',
    paper: LETTER_COUNTRIES.has(code) ? 'letter' : 'a4',
  };
}

export function functionLanguageFor(country: string): FunctionLanguage {
  const language = countryLocale(country).split('-')[0];
  if (language === 'pt') {
    return country === 'BR' ? 'pt-BR' : 'pt-PT';
  }
  return (FUNCTION_LANGUAGES as readonly string[]).includes(language) ? (language as FunctionLanguage) : 'en';
}

export function spreadsheetCountryDefaults(country: string, functions: FunctionLanguage): SpreadsheetRegional {
  const formats = countryDefaults(country);
  return {
    country: formats.country,
    date: formats.date,
    time: formats.time,
    number: formats.number,
    currency: COUNTRY_CURRENCIES[formats.country],
    functions,
  };
}

export function spreadsheetDefaults(account: RegionalPreferences): SpreadsheetRegional {
  return {
    country: account.country,
    date: account.date,
    time: account.time,
    number: account.number,
    currency: COUNTRY_CURRENCIES[account.country] ?? COUNTRY_CURRENCIES[FALLBACK_COUNTRY],
    functions: functionLanguageFor(account.country),
  };
}

export function countryFromLocale(locale: string | undefined): string {
  if (locale === undefined || locale === '') {
    return FALLBACK_COUNTRY;
  }
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region !== undefined && isCountry(region) ? region : FALLBACK_COUNTRY;
  } catch {
    return FALLBACK_COUNTRY;
  }
}

export function browserCountry(): string {
  return countryFromLocale(typeof navigator === 'undefined' ? undefined : navigator.language);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseRegionalPreferences(value: unknown, fallbackCountry: string): RegionalPreferences {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const defaults = countryDefaults(isCountry(record.country) ? record.country : fallbackCountry);
  return {
    country: defaults.country,
    date: oneOf(record.date, DATE_FORMATS, defaults.date),
    time: oneOf(record.time, TIME_FORMATS, defaults.time),
    number: oneOf(record.number, NUMBER_FORMATS, defaults.number),
    measurement: oneOf(record.measurement, MEASUREMENT_SYSTEMS, defaults.measurement),
    paper: oneOf(record.paper, PAPER_CHOICES, defaults.paper),
  };
}

export function parseSpreadsheetRegional(value: unknown, fallback: SpreadsheetRegional): SpreadsheetRegional {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const defaults = isCountry(record.country) ? spreadsheetCountryDefaults(record.country, fallback.functions) : fallback;
  return {
    country: defaults.country,
    date: oneOf(record.date, DATE_FORMATS, defaults.date),
    time: oneOf(record.time, TIME_FORMATS, defaults.time),
    number: oneOf(record.number, NUMBER_FORMATS, defaults.number),
    currency: typeof record.currency === 'string' && CURRENCY_CODE.test(record.currency) ? record.currency : defaults.currency,
    functions: oneOf(record.functions, FUNCTION_LANGUAGES, defaults.functions),
  };
}

export function differsFromCountry(preferences: RegionalPreferences): CountryField[] {
  const defaults = countryDefaults(preferences.country);
  return COUNTRY_FIELDS.filter((field) => preferences[field] !== defaults[field]);
}

export function spreadsheetDiffersFromCountry(regional: SpreadsheetRegional): SpreadsheetCountryField[] {
  const defaults = spreadsheetCountryDefaults(regional.country, regional.functions);
  return SPREADSHEET_COUNTRY_FIELDS.filter((field) => regional[field] !== defaults[field]);
}

export function withSpreadsheetCountry(regional: SpreadsheetRegional, country: string): SpreadsheetRegional {
  return spreadsheetCountryDefaults(country, regional.functions);
}

function groupDigits(digits: string, separators: NumberSeparators): string {
  if (!separators.lakh || digits.length <= 3) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separators.group);
  }
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, separators.group);
  return `${head}${separators.group}${digits.slice(-3)}`;
}

export function formatPlainNumber(value: number, format: NumberFormat, fractionDigits = 2): string {
  const separators = NUMBER_SEPARATORS[format];
  const [integer, fraction] = Math.abs(value).toFixed(fractionDigits).split('.');
  const sign = value < 0 ? '-' : '';
  return `${sign}${groupDigits(integer, separators)}${fraction === undefined ? '' : separators.decimal + fraction}`;
}

export function formatDatePattern(date: Date, format: DateFormat): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return format
    .replace('yyyy', String(date.getUTCFullYear()))
    .replace('mm', pad(date.getUTCMonth() + 1))
    .replace('dd', pad(date.getUTCDate()));
}

export function formatTimePattern(hours: number, minutes: number, format: TimeFormat): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  if (format === '24h') {
    return `${pad(hours)}:${pad(minutes)}`;
  }
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour}:${pad(minutes)} ${hours < 12 ? 'AM' : 'PM'}`;
}

export function currencySymbol(currency: string, country: string): string {
  try {
    const parts = new Intl.NumberFormat(countryLocale(country), { style: 'currency', currency, currencyDisplay: 'symbol' }).formatToParts(1);
    return parts.find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

export function argumentSeparator(format: NumberFormat): ',' | ';' {
  return NUMBER_SEPARATORS[format].decimal === ',' ? ';' : ',';
}
export * from './active';
