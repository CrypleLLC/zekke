import { describe, expect, it } from 'vitest';
import {
  COUNTRY_CURRENCIES,
  argumentSeparator,
  currencySymbol,
  countryCodes,
  countryDefaults,
  countryFromLocale,
  countryName,
  currencyCodes,
  differsFromCountry,
  functionLanguageFor,
  parseSpreadsheetRegional,
  spreadsheetCountryDefaults,
  spreadsheetDefaults,
  spreadsheetDiffersFromCountry,
  withSpreadsheetCountry,
  activeRegional,
  regionalCount,
  regionalDate,
  regionalDateTime,
  regionalShortDate,
  regionalTime,
  setActiveRegional,
  formatDatePattern,
  formatPlainNumber,
  formatTimePattern,
  parseRegionalPreferences,
} from './index';

describe('a country’s defaults', () => {
  it.each([
    ['BR', 'dd/mm/yyyy', '24h', 'dot-comma', 'BRL', 'metric', 'a4'],
    ['US', 'mm/dd/yyyy', '12h', 'comma-dot', 'USD', 'imperial', 'letter'],
    ['GB', 'dd/mm/yyyy', '24h', 'comma-dot', 'GBP', 'metric', 'a4'],
    ['DE', 'dd.mm.yyyy', '24h', 'dot-comma', 'EUR', 'metric', 'a4'],
    ['FR', 'dd/mm/yyyy', '24h', 'space-comma', 'EUR', 'metric', 'a4'],
    ['CH', 'dd.mm.yyyy', '24h', 'apostrophe-dot', 'CHF', 'metric', 'a4'],
    ['IN', 'dd/mm/yyyy', '12h', 'indian', 'INR', 'metric', 'a4'],
    ['JP', 'yyyy/mm/dd', '24h', 'comma-dot', 'JPY', 'metric', 'a4'],
    ['SE', 'yyyy-mm-dd', '24h', 'space-comma', 'SEK', 'metric', 'a4'],
    ['MX', 'dd/mm/yyyy', '12h', 'comma-dot', 'MXN', 'metric', 'letter'],
    ['PT', 'dd/mm/yyyy', '24h', 'space-comma', 'EUR', 'metric', 'a4'],
    ['CA', 'yyyy-mm-dd', '12h', 'comma-dot', 'CAD', 'metric', 'letter'],
  ])('%s: %s, %s, %s, %s, %s, %s', (country, date, time, number, currency, measurement, paper) => {
    expect(countryDefaults(country)).toEqual({ country, date, time, number, measurement, paper });
    expect(spreadsheetCountryDefaults(country, 'en')).toEqual({ country, date, time, number, currency, functions: 'en' });
  });

  it('gives every listed country a name, a currency Intl knows and readable defaults', () => {
    const currencies = new Set(currencyCodes());
    expect(countryCodes().length).toBeGreaterThan(230);
    for (const country of countryCodes()) {
      expect(countryName(country)).not.toBe(country);
      expect(currencies.has(COUNTRY_CURRENCIES[country])).toBe(true);
      expect(() => countryDefaults(country)).not.toThrow();
    }
  });

  it('reads the country of the browser’s language, and the US when there is none', () => {
    expect(countryFromLocale('pt-BR')).toBe('BR');
    expect(countryFromLocale('de')).toBe('DE');
    expect(countryFromLocale('en')).toBe('US');
    expect(countryFromLocale(undefined)).toBe('US');
    expect(countryFromLocale('xx-invalid-!!')).toBe('US');
  });
});

describe('stored preferences', () => {
  it('keep every choice that differs from the country, and say which', () => {
    const stored = { ...countryDefaults('BR'), date: 'yyyy-mm-dd', measurement: 'imperial' };
    const read = parseRegionalPreferences(stored, 'US');
    expect(read).toEqual(stored);
    expect(differsFromCountry(read)).toEqual(['date', 'measurement']);
  });

  it('replace whatever cannot be read with the country’s default', () => {
    expect(parseRegionalPreferences({ country: 'BR', date: 'dd/yy', paper: 'folio', number: 7 }, 'US')).toEqual(countryDefaults('BR'));
    expect(parseRegionalPreferences('nonsense', 'FR')).toEqual(countryDefaults('FR'));
    expect(parseRegionalPreferences({ country: 'ZZ' }, 'DE')).toEqual(countryDefaults('DE'));
  });
});

describe('a spreadsheet’s own settings', () => {
  it('start from the account’s formats, the country’s currency and the country’s function names when Excel has them', () => {
    const account = { ...countryDefaults('BR'), date: 'yyyy-mm-dd' as const, measurement: 'imperial' as const };
    expect(spreadsheetDefaults(account)).toEqual({
      country: 'BR',
      date: 'yyyy-mm-dd',
      time: '24h',
      number: 'dot-comma',
      currency: 'BRL',
      functions: 'pt-BR',
    });
  });

  it.each([
    ['BR', 'pt-BR'],
    ['PT', 'pt-PT'],
    ['AO', 'pt-PT'],
    ['MX', 'es'],
    ['CA', 'en'],
    ['CH', 'de'],
    ['FR', 'fr'],
    ['IT', 'en'],
    ['JP', 'en'],
  ])('name functions as %s does in Excel: %s', (country, language) => {
    expect(functionLanguageFor(country)).toBe(language);
  });

  it('take every format from a newly chosen country, keeping the function names, and say which differ', () => {
    const changed = { ...spreadsheetCountryDefaults('BR', 'en'), currency: 'USD' };
    expect(spreadsheetDiffersFromCountry(changed)).toEqual(['currency']);
    expect(withSpreadsheetCountry(changed, 'DE')).toEqual(spreadsheetCountryDefaults('DE', 'en'));
  });

  it('read back what was stored, with the fallback for what cannot be read', () => {
    const fallback = spreadsheetCountryDefaults('US', 'en');
    expect(parseSpreadsheetRegional({ country: 'FR', currency: 'CHF', functions: 'fr' }, fallback)).toEqual({
      ...spreadsheetCountryDefaults('FR', 'fr'),
      currency: 'CHF',
    });
    expect(parseSpreadsheetRegional({ country: 'ZZ', currency: 'reais', functions: 'xx' }, fallback)).toEqual(fallback);
  });
});

describe('dates and counts across the app', () => {
  it('follow the active preferences, in local time, with a short form that drops the year', () => {
    const brazil = countryDefaults('BR');
    const us = countryDefaults('US');
    const moment = new Date(2026, 9, 7, 13, 5);
    expect(regionalDate(moment, brazil)).toBe('07/10/2026');
    expect(regionalDate(moment, us)).toBe('10/07/2026');
    expect(regionalShortDate(moment, brazil)).toBe('07/10');
    expect(regionalShortDate(moment, { ...brazil, date: 'yyyy-mm-dd' })).toBe('10-07');
    expect(regionalTime(moment, us)).toBe('1:05 PM');
    expect(regionalDateTime(moment, brazil)).toBe('07/10/2026 13:05');
    expect(regionalCount(1234567, brazil)).toBe('1.234.567');
    setActiveRegional(us);
    expect(activeRegional()).toEqual(us);
  });
});

describe('formatting with a preference', () => {
  it('writes numbers with each grouping', () => {
    expect(formatPlainNumber(1234567.891, 'comma-dot')).toBe('1,234,567.89');
    expect(formatPlainNumber(1234567.891, 'dot-comma')).toBe('1.234.567,89');
    expect(formatPlainNumber(-1234567.891, 'space-comma')).toBe('-1 234 567,89');
    expect(formatPlainNumber(1234567.891, 'apostrophe-dot')).toBe('1’234’567.89');
    expect(formatPlainNumber(1234567.891, 'indian')).toBe('12,34,567.89');
    expect(formatPlainNumber(999, 'indian', 0)).toBe('999');
  });

  it('writes dates and times', () => {
    const date = new Date(Date.UTC(2026, 9, 7));
    expect(formatDatePattern(date, 'dd/mm/yyyy')).toBe('07/10/2026');
    expect(formatDatePattern(date, 'mm/dd/yyyy')).toBe('10/07/2026');
    expect(formatDatePattern(date, 'yyyy.mm.dd')).toBe('2026.10.07');
    expect(formatTimePattern(0, 5, '12h')).toBe('12:05 AM');
    expect(formatTimePattern(13, 5, '12h')).toBe('1:05 PM');
    expect(formatTimePattern(13, 5, '24h')).toBe('13:05');
  });

  it('writes a currency’s symbol as the person’s country writes it', () => {
    expect(currencySymbol('BRL', 'BR')).toBe('R$');
    expect(currencySymbol('USD', 'BR')).toBe('US$');
    expect(currencySymbol('EUR', 'DE')).toBe('€');
    expect(currencySymbol('USD', 'US')).toBe('$');
  });

  it('separates formula arguments with a semicolon where the decimal sign is a comma', () => {
    expect(argumentSeparator('dot-comma')).toBe(';');
    expect(argumentSeparator('space-comma')).toBe(';');
    expect(argumentSeparator('comma-dot')).toBe(',');
    expect(argumentSeparator('apostrophe-dot')).toBe(',');
  });
});
