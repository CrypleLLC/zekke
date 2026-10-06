import { describe, expect, it } from 'vitest';
import { CHART_KINDS } from '@/lib/spreadsheets/charts';
import { CHART_KIND_LABELS, chartAccessibleName, chartHeadersLabel } from './spreadsheet-charts';

describe('chart copy', () => {
  it('names every kind of chart', () => {
    for (const kind of CHART_KINDS) {
      expect(CHART_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it('says which line holds the series names', () => {
    expect(chartHeadersLabel('columns')).toContain('first row');
    expect(chartHeadersLabel('rows')).toContain('first column');
  });

  it('names a chart by its title when it has one', () => {
    expect(chartAccessibleName(undefined)).toBe('Chart');
    expect(chartAccessibleName('Spend')).toBe('Chart: Spend');
  });
});
