'use client';

import { useMemo, useState } from 'react';
import {
  MEASUREMENT_LABELS,
  REGION_COPY,
  REGION_PAPER_LABELS,
  countryDefaultHint,
  dateFormatLabel,
  numberFormatLabel,
  timeFormatLabel,
} from '@/lib/app';
import {
  DATE_FORMATS,
  MEASUREMENT_SYSTEMS,
  NUMBER_FORMATS,
  PAPER_CHOICES,
  TIME_FORMATS,
  countryCodes,
  countryDefaults,
  countryName,
  differsFromCountry,
  type CountryField,
  type RegionalPreferences,
} from '@/lib/regional';
import { useZekke } from '@/components/session/ZekkeProvider';
import { useRegionalPreferences } from '@/components/session/usePreferences';
import { Button, Card, Notice, Select, Spinner } from '@/components/ui';

export default function RegionScreen() {
  const { reportError } = useZekke();
  const { regional, loaded, saveRegional } = useRegionalPreferences();
  const [message, setMessage] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  const countries = useMemo(
    () =>
      countryCodes()
        .map((code) => ({ value: code, label: countryName(code) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'en')),
    [],
  );
  const defaults = countryDefaults(regional.country);
  const changed = differsFromCountry(regional);

  async function save(edit: (current: RegionalPreferences) => RegionalPreferences) {
    setBusy(true);
    setMessage(undefined);
    setNotice(undefined);
    try {
      await saveRegional(edit);
      setNotice(REGION_COPY.saved);
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  function field<K extends CountryField>(key: K, value: RegionalPreferences[K]) {
    void save((current) => ({ ...current, [key]: value }));
  }

  if (!loaded) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  const hint = (key: CountryField) => countryDefaultHint(key, regional, defaults);

  return (
    <Card title={REGION_COPY.title} subtitle={REGION_COPY.summary}>
      <div className="space-y-4">
        {message ? (
          <Notice tone="danger" onDismiss={() => setMessage(undefined)}>
            {message}
          </Notice>
        ) : null}
        {notice ? (
          <Notice tone="success" onDismiss={() => setNotice(undefined)}>
            {notice}
          </Notice>
        ) : null}

        <Select
          label={REGION_COPY.country}
          choices={countries}
          value={regional.country}
          disabled={busy}
          onChange={(event) => {
            const country = event.target.value;
            void save(() => countryDefaults(country));
          }}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={REGION_COPY.date}
            hint={hint('date')}
            choices={DATE_FORMATS.map((format) => ({ value: format, label: dateFormatLabel(format) }))}
            value={regional.date}
            disabled={busy}
            onChange={(event) => field('date', event.target.value as RegionalPreferences['date'])}
          />
          <Select
            label={REGION_COPY.time}
            hint={hint('time')}
            choices={TIME_FORMATS.map((format) => ({ value: format, label: timeFormatLabel(format) }))}
            value={regional.time}
            disabled={busy}
            onChange={(event) => field('time', event.target.value as RegionalPreferences['time'])}
          />
          <Select
            label={REGION_COPY.number}
            hint={hint('number')}
            choices={NUMBER_FORMATS.map((format) => ({ value: format, label: numberFormatLabel(format) }))}
            value={regional.number}
            disabled={busy}
            onChange={(event) => field('number', event.target.value as RegionalPreferences['number'])}
          />
          <Select
            label={REGION_COPY.measurement}
            hint={hint('measurement')}
            choices={MEASUREMENT_SYSTEMS.map((system) => ({ value: system, label: MEASUREMENT_LABELS[system] }))}
            value={regional.measurement}
            disabled={busy}
            onChange={(event) => field('measurement', event.target.value as RegionalPreferences['measurement'])}
          />
          <Select
            label={REGION_COPY.paper}
            hint={hint('paper')}
            choices={PAPER_CHOICES.map((paper) => ({ value: paper, label: REGION_PAPER_LABELS[paper] }))}
            value={regional.paper}
            disabled={busy}
            onChange={(event) => field('paper', event.target.value as RegionalPreferences['paper'])}
          />
        </div>

        {changed.length > 0 ? (
          <Button variant="secondary" disabled={busy} onClick={() => void save((current) => countryDefaults(current.country))}>
            {REGION_COPY.restoreDefaults(countryName(regional.country))}
          </Button>
        ) : null}

        <p className="text-sm text-ink-muted">{REGION_COPY.sealed}</p>
      </div>
    </Card>
  );
}
