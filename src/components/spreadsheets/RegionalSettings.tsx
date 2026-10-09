'use client';

import { useMemo, useState } from 'react';
import {
  FUNCTION_LANGUAGE_COPY,
  FUNCTION_LANGUAGE_LABELS,
  REGION_COPY,
  SPREADSHEET_SETTINGS_COPY,
  countryDefaultHint,
  currencyLabel,
  dateFormatLabel,
  numberFormatLabel,
  timeFormatLabel,
} from '@/lib/app';
import {
  DATE_FORMATS,
  NUMBER_FORMATS,
  TIME_FORMATS,
  countryCodes,
  countryName,
  currencyCodes,
  spreadsheetCountryDefaults,
  spreadsheetDefaults,
  spreadsheetDiffersFromCountry,
  withSpreadsheetCountry,
  type SpreadsheetCountryField,
  type SpreadsheetRegional,
} from '@/lib/regional';
import { availableFunctionLanguages } from '@/lib/spreadsheets/function-names';
import { Button, Card, Notice, Select, Spinner } from '@/components/ui';
import type { SheetRegionalHandle } from './useSheetRegional';

function sameRegional(a: SpreadsheetRegional, b: SpreadsheetRegional): boolean {
  return (Object.keys(a) as (keyof SpreadsheetRegional)[]).every((key) => a[key] === b[key]);
}

export default function RegionalSettings({ handle }: { handle: SheetRegionalHandle }) {
  const { regional, account, loaded, saveRegional } = handle;
  const [notice, setNotice] = useState<string>();

  const countries = useMemo(
    () =>
      countryCodes()
        .map((code) => ({ value: code, label: countryName(code) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'en')),
    [],
  );
  const currencies = useMemo(
    () => currencyCodes().map((code) => ({ value: code, label: currencyLabel(code) })),
    [],
  );
  const defaults = spreadsheetCountryDefaults(regional.country, regional.functions);
  const changed = spreadsheetDiffersFromCountry(regional);
  const accountFormats = spreadsheetDefaults(account);

  function save(next: SpreadsheetRegional) {
    saveRegional(next);
    setNotice(SPREADSHEET_SETTINGS_COPY.saved);
  }

  function field<K extends SpreadsheetCountryField>(key: K, value: SpreadsheetRegional[K]) {
    save({ ...regional, [key]: value });
  }

  if (!loaded) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  const hint = (key: SpreadsheetCountryField) => countryDefaultHint(key, regional, defaults);

  return (
    <div className="space-y-5">
      <Card title={SPREADSHEET_SETTINGS_COPY.formatsTitle} subtitle={SPREADSHEET_SETTINGS_COPY.formatsSummary}>
        <div className="space-y-4">
          {notice ? (
            <Notice tone="success" onDismiss={() => setNotice(undefined)}>
              {notice}
            </Notice>
          ) : null}

          <Select
            label={REGION_COPY.country}
            choices={countries}
            value={regional.country}
            onChange={(event) => save(withSpreadsheetCountry(regional, event.target.value))}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={REGION_COPY.date}
              hint={hint('date')}
              choices={DATE_FORMATS.map((format) => ({ value: format, label: dateFormatLabel(format) }))}
              value={regional.date}
              onChange={(event) => field('date', event.target.value as SpreadsheetRegional['date'])}
            />
            <Select
              label={REGION_COPY.time}
              hint={hint('time')}
              choices={TIME_FORMATS.map((format) => ({ value: format, label: timeFormatLabel(format) }))}
              value={regional.time}
              onChange={(event) => field('time', event.target.value as SpreadsheetRegional['time'])}
            />
            <Select
              label={REGION_COPY.number}
              hint={hint('number')}
              choices={NUMBER_FORMATS.map((format) => ({ value: format, label: numberFormatLabel(format) }))}
              value={regional.number}
              onChange={(event) => field('number', event.target.value as SpreadsheetRegional['number'])}
            />
            <Select
              label={REGION_COPY.currency}
              hint={hint('currency')}
              choices={currencies}
              value={regional.currency}
              onChange={(event) => field('currency', event.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {changed.length > 0 ? (
              <Button variant="secondary" onClick={() => save(withSpreadsheetCountry(regional, regional.country))}>
                {REGION_COPY.restoreDefaults(countryName(regional.country))}
              </Button>
            ) : null}
            {sameRegional(regional, accountFormats) ? null : (
              <Button variant="secondary" onClick={() => save(accountFormats)}>
                {SPREADSHEET_SETTINGS_COPY.restoreAccount}
              </Button>
            )}
          </div>
        </div>
      </Card>
      <Card title={FUNCTION_LANGUAGE_COPY.title} subtitle={FUNCTION_LANGUAGE_COPY.summary}>
        <Select
          label={FUNCTION_LANGUAGE_COPY.label}
          choices={availableFunctionLanguages().map((language) => ({
            value: language,
            label: FUNCTION_LANGUAGE_LABELS[language],
          }))}
          value={regional.functions}
          onChange={(event) => save({ ...regional, functions: event.target.value as SpreadsheetRegional['functions'] })}
        />
      </Card>
    </div>
  );
}
