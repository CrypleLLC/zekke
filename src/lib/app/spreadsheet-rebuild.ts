import { RebuildNotSyncedError, RebuildTooLargeError, type RebuildEstimate, type RebuildResult } from "@/lib/spreadsheets/rebuild-item";
import { daysLabel } from "./trash";
import { formatBytes } from "./vault";

export const REBUILD_LABELS = {
  offer: "Rebuild without history…",
  title: "Rebuild this spreadsheet without its history",
  measuring: "Measuring what a rebuild would save…",
  confirm: "Rebuild",
  working: "Rebuilding…",
  cancel: "Keep it as it is",
  openNew: "Open the new copy",
} as const;

export const REBUILD_OFFER_MESSAGE =
  "Much of this spreadsheet's size may be the history of values it replaced. Rebuilding keeps only what it shows now.";

export function rebuildSavingLabel(estimate: RebuildEstimate): string {
  const saved = estimate.currentBytes - estimate.rebuiltBytes;
  if (saved <= estimate.currentBytes * 0.1) {
    return `A rebuild would barely help: ${formatBytes(estimate.currentBytes)} now, ${formatBytes(estimate.rebuiltBytes)} rebuilt. The size is its content, not its history.`;
  }
  return `It would go from ${formatBytes(estimate.currentBytes)} to ${formatBytes(estimate.rebuiltBytes)}.`;
}

export function rebuildConsequences(retentionDays: number): string[] {
  return [
    "It becomes a new spreadsheet, in the same folder. Every cell, formula, chart, filter, rule and print setting is kept; undo starts afresh.",
    "Edits made on another device and not yet saved — one that is offline, say — will not reach the new copy. A device that has it open is told where the new copy is.",
    retentionDays > 0
      ? `This copy moves to the Trash, where you can restore it for ${daysLabel(retentionDays)}.`
      : "This copy is deleted for good: your account keeps nothing in the Trash.",
    "The new copy is not shared with anyone. Share it again if others need it.",
  ];
}

export function rebuildErrorMessage(error: unknown): string | undefined {
  if (error instanceof RebuildNotSyncedError) {
    return "This device has edits it has not saved, or has not received everything yet. Wait until it says saved, then try again.";
  }
  if (error instanceof RebuildTooLargeError) {
    return "Even without its history this spreadsheet is too large to store as one copy, so it cannot be rebuilt. Remove content first.";
  }
  return undefined;
}

export function rebuildOutcomeMessage(result: RebuildResult): string | undefined {
  const problems: string[] = [];
  if (!result.trashed) {
    problems.push("the old copy could not be moved to the Trash — delete it from Spreadsheets");
  }
  if (!result.movedToFolder) {
    problems.push("the new copy may be at the top level rather than in the old one's folder");
  }
  return problems.length === 0 ? undefined : `Rebuilt, but ${problems.join(", and ")}.`;
}

export const REPLACED_MESSAGE = "This spreadsheet was rebuilt into a new copy. Edits made here do not reach it.";
