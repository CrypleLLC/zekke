import { describe, expect, it } from 'vitest';
import { chartOption, DEFAULT_CHART_SETTINGS } from '@/lib/spreadsheets';
import { chartSvg, svgDataUrl } from './chart-svg';

describe('a chart drawn for print', () => {
  it('is a self-contained SVG of the requested size, with its labels as text', () => {
    const option = chartOption({ ...DEFAULT_CHART_SETTINGS, title: 'Spend' }, [
      ['Month', 'Rent'],
      ['Jan', 1200],
      ['Feb', 1250],
    ]);
    const svg = chartSvg(option, 480, 300);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="480"');
    expect(svg).toContain('height="300"');
    expect(svg).toContain('Spend');
    expect(svg).not.toMatch(/<script|<foreignObject|href="http/i);
    expect(svgDataUrl(svg).startsWith('data:image/svg+xml;charset=utf-8,%3Csvg')).toBe(true);
  });
});
