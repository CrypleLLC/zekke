export const FEED_SCOPES = ['passwords', 'secrets', 'notes', 'documents', 'files'] as const;

export type FeedScope = (typeof FEED_SCOPES)[number];

export type ItemType =
  | 'credential'
  | 'secret'
  | 'note'
  | 'folder_manifest'
  | 'document'
  | 'document_folder'
  | 'file'
  | 'file_folder';

export interface Change {
  seq: number;
  type: ItemType;
  id: string;
  tombstone: boolean;
  item?: Record<string, unknown>;
}

export interface ChangesPage {
  changes: Change[];
  cursor: number;
  more: boolean;
}

export const FEED_PAGE_LIMIT = 500;

export function isFeedScope(value: string): value is FeedScope {
  return (FEED_SCOPES as readonly string[]).includes(value);
}
