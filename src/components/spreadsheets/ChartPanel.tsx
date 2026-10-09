'use client';

import { useState } from 'react';
import {
  CHART_KIND_LABELS,
  CHART_LABELS,
  SERIES_ORIENTATION_LABELS,
  chartHeadersLabel,
} from '@/lib/app';
import {
  CHART_KINDS,
  isChartKind,
  rangeLabel,
  type ChartSettings,
  type ResolvedChart,
  type SeriesOrientation,
} from '@/lib/spreadsheets';
import { Button, Field, IconButton, Select } from '@/components/ui';
import { CloseIcon, TrashIcon } from '@/components/ui/icons';

const KIND_CHOICES = CHART_KINDS.map((kind) => ({ value: kind, label: CHART_KIND_LABELS[kind] }));
const SERIES_CHOICES = (Object.keys(SERIES_ORIENTATION_LABELS) as SeriesOrientation[]).map((series) => ({
  value: series,
  label: SERIES_ORIENTATION_LABELS[series],
}));

export default function ChartPanel({
  chart,
  onSettings,
  onUseSelection,
  onRemove,
  onClose,
}: {
  chart: ResolvedChart;
  onSettings: (settings: ChartSettings) => void;
  onUseSelection: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { settings } = chart;
  const [title, setTitle] = useState(settings.title ?? '');
  const [editedFor, setEditedFor] = useState(`${chart.id}:${settings.title ?? ''}`);
  const stored = `${chart.id}:${settings.title ?? ''}`;
  if (stored !== editedFor) {
    setEditedFor(stored);
    setTitle(settings.title ?? '');
  }

  function commitTitle() {
    const trimmed = title.trim();
    if (trimmed === (settings.title ?? '')) {
      return;
    }
    onSettings({ ...settings, title: trimmed === '' ? undefined : trimmed });
  }

  return (
    <aside
      data-chart-panel
      aria-label={CHART_LABELS.panel}
      className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-headline text-ink">{CHART_LABELS.panel}</h2>
        <IconButton label={CHART_LABELS.close} onClick={onClose}>
          <CloseIcon className="h-4 w-4 shrink-0" />
        </IconButton>
      </div>

      <Field
        label={CHART_LABELS.title}
        placeholder={CHART_LABELS.titlePlaceholder}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitTitle();
          }
        }}
      />

      <Select
        label={CHART_LABELS.kind}
        choices={KIND_CHOICES}
        value={settings.kind}
        onChange={(event) => {
          if (isChartKind(event.target.value)) {
            onSettings({ ...settings, kind: event.target.value });
          }
        }}
      />

      <Select
        label={CHART_LABELS.series}
        choices={SERIES_CHOICES}
        value={settings.series}
        onChange={(event) =>
          onSettings({ ...settings, series: event.target.value === 'rows' ? 'rows' : 'columns' })
        }
      />

      <label className="flex items-start gap-2 text-compact text-ink-soft">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-brand-500"
          checked={settings.headers}
          onChange={(event) => onSettings({ ...settings, headers: event.target.checked })}
        />
        <span>{chartHeadersLabel(settings.series)}</span>
      </label>

      <div>
        <p className="text-compact font-semibold text-ink-soft">{CHART_LABELS.data}</p>
        <p className="mt-1.5 font-mono text-sm text-ink">{rangeLabel(chart.source)}</p>
        <Button variant="secondary" className="mt-2" onClick={onUseSelection}>
          {CHART_LABELS.useSelection}
        </Button>
      </div>

      <div className="mt-auto">
        <Button variant="danger" onClick={onRemove}>
          <TrashIcon className="h-4 w-4" />
          {CHART_LABELS.remove}
        </Button>
      </div>
    </aside>
  );
}
