import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TitleComponent } from 'echarts/components';
import { init, use as registerChartModules } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

registerChartModules([BarChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent, TitleComponent, SVGRenderer]);

export function chartSvg(option: Record<string, unknown>, width: number, height: number): string {
  const chart = init(null, undefined, {
    renderer: 'svg',
    ssr: true,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  });
  try {
    const { tooltip: _tooltip, ...printable } = option;
    chart.setOption({ ...printable, animation: false });
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
