import type { DocumentKind, DocumentSummary, SnapshotCapacity } from "@/lib/documents";
import type { FirstPage, SyncStatus } from "@/lib/documents";
import { cellsInBytes, type CapacityRefusal } from "@/lib/spreadsheets/capacity";
import { daysLabel } from "./trash";
import { countOf, DOCUMENT_NOUNS, SPREADSHEET_NOUNS, type FolderNouns } from "./folders";

export const UNTITLED_DOCUMENT = "Untitled document";
export const UNTITLED_SPREADSHEET = "Untitled spreadsheet";
export const UNREADABLE_DOCUMENT_TITLE = "Unreadable document";
export const UNTITLED_HEADING = "Untitled heading";
export const DOCUMENT_TITLE_MAX_CHARACTERS = 80;
export const DOCUMENT_PREVIEW_MAX_CHARACTERS = 180;
export const DOCUMENT_THUMBNAIL_MAX_CHARACTERS = 1200;

const ELLIPSIS = "…";

function truncate(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length <= limit
    ? text
    : `${characters.slice(0, limit).join("").trimEnd()}${ELLIPSIS}`;
}

export function untitledLabel(kind: DocumentKind): string {
  return kind === "spreadsheet" ? UNTITLED_SPREADSHEET : UNTITLED_DOCUMENT;
}

export function documentTitle(title: string, kind: DocumentKind = "document"): string {
  const trimmed = title.trim();
  return trimmed.length === 0
    ? untitledLabel(kind)
    : truncate(trimmed, DOCUMENT_TITLE_MAX_CHARACTERS);
}

export function documentPreview(preview: string): string {
  const collapsed = preview.replace(/\s+/g, " ").trim();
  return truncate(collapsed, DOCUMENT_PREVIEW_MAX_CHARACTERS);
}

export function documentThumbnail(body: string): string {
  const collapsed = body.replace(/\n{3,}/g, "\n\n").trim();
  return truncate(collapsed, DOCUMENT_THUMBNAIL_MAX_CHARACTERS);
}

export const SAVE_STATUS_LABELS: Record<SyncStatus, string> = {
  idle: "",
  loading: "Opening…",
  synced: "All changes saved",
  saving: "Saving…",
  offline: "Offline — changes are kept on this device",
  error: "Sync paused",
};

export function saveStatusLabel(status: SyncStatus, pending: number): string {
  if (status === "offline" && pending > 0) {
    const changes = pending === 1 ? "1 change" : `${pending} changes`;
    return `Offline — ${changes} kept on this device`;
  }
  return SAVE_STATUS_LABELS[status];
}

export type SaveIndicator = "opening" | "unsaved" | "saving" | "saved";

export interface SaveProgress {
  status: SyncStatus;
  pending: number;
  uploading: boolean;
  gapDetected: boolean;
}

export function saveIndicator(progress: SaveProgress): SaveIndicator {
  if (progress.status === "idle" || progress.status === "loading") {
    return "opening";
  }
  if (progress.gapDetected || progress.status === "error") {
    return "unsaved";
  }
  if (progress.uploading) {
    return "saving";
  }
  return progress.pending > 0 ? "unsaved" : "saved";
}

export function saveIndicatorLabel(progress: SaveProgress): string {
  const indicator = saveIndicator(progress);
  if (indicator === "saving") {
    return SAVE_STATUS_LABELS.saving;
  }
  if (indicator === "unsaved" && progress.status === "saving") {
    return "Changes not saved yet";
  }
  return saveStatusLabel(progress.status, progress.pending);
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function editedLabel(updatedAt: string, now: Date = new Date()): string {
  const at = new Date(updatedAt);
  if (Number.isNaN(at.getTime())) {
    return "Edited recently";
  }

  const elapsed = now.getTime() - at.getTime();
  if (elapsed < MINUTE_MS) {
    return "Edited just now";
  }
  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS);
    return `Edited ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    return `Edited ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  return `Edited ${at.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: at.getFullYear() === now.getFullYear() ? undefined : "numeric",
  })}`;
}

export interface DocumentTile {
  id: string;
  kind: DocumentKind;
  grid?: string[][];
  firstPage?: FirstPage;
  title: string;
  preview: string;
  thumbnail: string;
  edited: string;
  updatedAt: string;
  createdAt: string;
  bytes?: number;
  readable: boolean;
  pendingUpdates: number;
  failure?: string;
}

export function buildDocumentTiles(
  summaries: readonly DocumentSummary[],
  now: Date = new Date(),
): DocumentTile[] {
  return summaries
    .map((summary) => ({
      id: summary.id,
      kind: summary.kind,
      grid: summary.readable ? summary.grid : undefined,
      firstPage: summary.readable ? summary.firstPage : undefined,
      title: summary.readable
        ? documentTitle(summary.title, summary.kind)
        : UNREADABLE_DOCUMENT_TITLE,
      preview: summary.readable ? documentPreview(summary.preview) : "",
      thumbnail: summary.readable ? documentThumbnail(summary.preview) : "",
      edited: editedLabel(summary.updatedAt, now),
      updatedAt: summary.updatedAt,
      createdAt: summary.createdAt,
      bytes: summary.bytes,
      readable: summary.readable,
      pendingUpdates: Math.max(summary.latestSeq - summary.snapshotSeq, 0),
      failure: summary.failure,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function documentCountLabel(count: number, nouns: FolderNouns = DOCUMENT_NOUNS): string {
  return countOf(count, nouns);
}

export function documentDeleteConfirmation(
  count: number,
  retentionDays = 0,
  nouns: FolderNouns = DOCUMENT_NOUNS,
): string {
  const documents = count === 1 ? `this ${nouns.one}` : `these ${count} ${nouns.many}`;
  const them = count === 1 ? "it" : "them";
  if (retentionDays > 0) {
    return `${capitalise(documents)} ${count === 1 ? "goes" : "go"} to the Trash, where you can restore ${them} for ${daysLabel(retentionDays)}. After that ${count === 1 ? "it is" : "they are"} deleted for good.`;
  }
  return `Deleting ${documents} is permanent. Only this account holds the keys, so nobody — including Zekke — can restore ${them}.`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function documentHref(id: string, kind: DocumentKind = "document"): string {
  return kind === "spreadsheet" ? `/sheets/${id}` : `/docs/${id}`;
}

export type DocumentShelfGrid = "documents" | "spreadsheets";

export interface DocumentShelf {
  kind: DocumentKind;
  grid: DocumentShelfGrid;
  rootLabel: string;
  nouns: FolderNouns;
  emptyRoot: string;
  emptyFolder: string;
  sizeGroupLabel: string;
  smallerLabel: string;
  largerLabel: string;
}

export const DOCUMENT_SHELVES: Record<DocumentKind, DocumentShelf> = {
  document: {
    kind: "document",
    grid: "documents",
    rootLabel: "Documents",
    nouns: DOCUMENT_NOUNS,
    emptyRoot: "Long-form writing, encrypted on this device before it is stored. Each document opens in its own tab.",
    emptyFolder: "This folder holds no documents. Drag documents onto it, or create one while it is open.",
    sizeGroupLabel: "Document size",
    smallerLabel: "Smaller documents",
    largerLabel: "Larger documents",
  },
  spreadsheet: {
    kind: "spreadsheet",
    grid: "spreadsheets",
    rootLabel: "Spreadsheets",
    nouns: SPREADSHEET_NOUNS,
    emptyRoot: "Tables and figures, encrypted on this device before they are stored. Each spreadsheet opens in its own tab.",
    emptyFolder: "This folder holds no spreadsheets. Drag spreadsheets onto it, or create one while it is open.",
    sizeGroupLabel: "Spreadsheet size",
    smallerLabel: "Smaller spreadsheets",
    largerLabel: "Larger spreadsheets",
  },
};

export function shelfEmptyLabel(shelf: DocumentShelf, inFolder: boolean): string {
  return inFolder ? `No ${shelf.nouns.many} in this folder` : `No ${shelf.nouns.many} yet`;
}

export function tilesOnShelf<T extends { kind: DocumentKind }>(tiles: readonly T[], kind: DocumentKind): T[] {
  return tiles.filter((tile) => tile.kind === kind);
}

export const NEW_ITEM_LABELS = {
  menu: "New",
  document: "New document",
  spreadsheet: "New spreadsheet",
} as const;

export function capacityRefusalMessage(refusal: CapacityRefusal): string {
  if (refusal.reason === "cell-too-large") {
    return "That cell is too large to store. Split its content across several cells.";
  }
  const room = Math.max(0, refusal.limitBytes - refusal.usedBytes);
  const fits = cellsInBytes(room);
  const asked = cellsInBytes(refusal.addedBytes);
  return fits === 0
    ? "This spreadsheet is full: nothing more can be added. Remove content, or start a new spreadsheet."
    : `This spreadsheet has room for about ${fits.toLocaleString()} more cells, and that change needs about ${asked.toLocaleString()}. Nothing was changed.`;
}

export function snapshotCapacityMessage(capacity: SnapshotCapacity): string | undefined {
  switch (capacity) {
    case "near":
      return "This spreadsheet is close to the largest size Zekke can store.";
    case "over":
      return "This spreadsheet is past the largest size Zekke can store. Your edits are saved, but it can no longer be compacted, so it will open more slowly. Remove content to bring it back under.";
    default:
      return undefined;
  }
}

export function documentCountsLabel(
  words: number,
  characters: number,
  pages?: number,
): string {
  const text = `${words.toLocaleString()} ${words === 1 ? "word" : "words"} · ${characters.toLocaleString()} ${
    characters === 1 ? "character" : "characters"
  }`;
  if (pages === undefined) {
    return text;
  }
  const sheets = Math.max(1, Math.round(pages));
  return `${text} · ${sheets} ${sheets === 1 ? "page" : "pages"}`;
}
