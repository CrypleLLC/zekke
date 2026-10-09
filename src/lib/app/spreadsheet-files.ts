import { SNAPSHOT_RAW_BYTES_LIMIT, cellsInBytes } from "@/lib/spreadsheets/capacity";
import { ImportTooLargeError, UnsupportedFormatError } from "@/lib/spreadsheets/interchange";
import type { InterchangeReport, LostFeature } from "@/lib/spreadsheets/xlsx";
import { regionalCount } from '@/lib/regional';

export const SPREADSHEET_FILE_LABELS = {
  import: "Import a spreadsheet…",
  download: "Download",
  xlsx: "Excel workbook (.xlsx)",
  csv: "This sheet as CSV (.csv)",
  tsv: "This sheet as TSV (.tsv)",
} as const;

const LOST_FEATURE_NOUNS: Record<LostFeature, [string, string]> = {
  comments: ["comment", "comments"],
  images: ["image", "images"],
  charts: ["chart", "charts"],
  tables: ["table's formatting", "tables' formatting"],
  pivotTables: ["pivot table", "pivot tables"],
  dataValidations: ["data validation rule", "data validation rules"],
  conditionalFormats: ["conditional format", "conditional formats"],
  richText: ["cell's mixed formatting", "cells' mixed formatting"],
  hyperlinks: ["link (the text is kept)", "links (the text is kept)"],
  themeColours: ["theme colour", "theme colours"],
  arrayFormulas: ["array formula, kept as an ordinary one", "array formulas, kept as ordinary ones"],
  gradientFills: ["gradient fill", "gradient fills"],
};

export function lostFeaturesLabel(report: InterchangeReport): string | undefined {
  const parts = (Object.entries(report) as [LostFeature, number][])
    .filter(([, count]) => count > 0)
    .map(([feature, count]) => {
      const [one, many] = LOST_FEATURE_NOUNS[feature];
      return `${regionalCount(count)} ${count === 1 ? one : many}`;
    });
  return parts.length === 0 ? undefined : parts.join(", ");
}

export function importedMessage(title: string, sheets: number, report: InterchangeReport): string {
  const opened = `Imported “${title}”${sheets > 1 ? ` with ${sheets} sheets` : ""}. It opens in its own tab.`;
  const lost = lostFeaturesLabel(report);
  return lost === undefined ? opened : `${opened} Not carried over: ${lost}.`;
}

export function importErrorMessage(error: unknown): string | undefined {
  if (error instanceof UnsupportedFormatError) {
    return "Only .xlsx, .csv and .tsv files can be imported.";
  }
  if (error instanceof ImportTooLargeError) {
    return error.refusal.reason === "cell-too-large"
      ? "That file has a cell too large to store. Split its content across several cells and import it again."
      : `That file is larger than a spreadsheet can hold, which is about ${regionalCount(cellsInBytes(SNAPSHOT_RAW_BYTES_LIMIT))} filled cells. Nothing was created.`;
  }
  return undefined;
}

export const UNREADABLE_IMPORT = "That file could not be read as a spreadsheet. Nothing was created.";
