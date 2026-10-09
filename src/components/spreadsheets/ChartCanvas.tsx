'use client';

import { useEffect, useRef } from 'react';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { init, use as registerChartModules, type ECharts } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

registerChartModules([BarChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

export default function ChartCanvas({
  option,
  width,
  height,
}: {
  option: Record<string, unknown>;
  width: number;
  height: number;
}) {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | undefined>(undefined);
  const drawn = useRef<string>('');
  const optionKey = JSON.stringify(option);

  useEffect(() => {
    const target = element.current;
    if (target === null) {
      return;
    }
    const created = init(target, undefined, { renderer: 'canvas' });
    chart.current = created;
    drawn.current = '';
    return () => {
      created.dispose();
      chart.current = undefined;
    };
  }, []);

  useEffect(() => {
    const current = chart.current;
    if (current === undefined || drawn.current === optionKey) {
      return;
    }
    drawn.current = optionKey;
    current.setOption(JSON.parse(optionKey) as Record<string, unknown>, true);
  }, [optionKey]);

  useEffect(() => {
    if (width > 0 && height > 0) {
      chart.current?.resize({ width: Math.round(width), height: Math.round(height) });
    }
  }, [width, height]);

  return <div ref={element} className="h-full w-full" />;
}
