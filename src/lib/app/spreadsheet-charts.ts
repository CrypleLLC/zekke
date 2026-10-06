import type { ChartKind, SeriesOrientation } from "@/lib/spreadsheets/charts";

export const CHART_LABELS = {
  insert: "Insert chart",
  panel: "Chart",
  close: "Close the chart settings",
  title: "Title",
  titlePlaceholder: "No title",
  kind: "Type",
  series: "Series",
  data: "Data",
  useSelection: "Use the selected cells",
  remove: "Delete chart",
  chart: "Chart",
} as const;

export const CHART_KIND_LABELS: Record<ChartKind, string> = {
  column: "Column",
  bar: "Bar",
  line: "Line",
  area: "Area",
  pie: "Pie",
  scatter: "Scatter",
};

export const SERIES_ORIENTATION_LABELS: Record<SeriesOrientation, string> = {
  columns: "One per column",
  rows: "One per row",
};

export const CHART_NEEDS_RANGE =
  "Select the cells to chart, with their headers, then insert the chart.";

export function chartHeadersLabel(series: SeriesOrientation): string {
  return series === "columns"
    ? "The first row names the series"
    : "The first column names the series";
}

export function chartAccessibleName(title: string | undefined): string {
  return title === undefined ? CHART_LABELS.chart : `${CHART_LABELS.chart}: ${title}`;
}
