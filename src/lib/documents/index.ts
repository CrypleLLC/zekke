import { MAX_PAGE_LIMIT } from '@/lib/api';
import {
  compactDocument,
  getDocument,
  listDocumentsMeta,
  listUpdatesSince,
  appendUpdates,
  type DocumentsContext,
} from './api';
import { openDocumentDek } from './crypto';
import { putAttachmentReferences } from './attachments/api';
import type { DocumentTransport } from './sync';

export function apiTransport(context: DocumentsContext): DocumentTransport {
  return {
    fetchDocument: (id) => getDocument(context, id),
    fetchUpdates: (id, since, options) =>
      listUpdatesSince(context, id, since, {
        limit: MAX_PAGE_LIMIT,
        expectFollowing: options?.expectFollowing,
      }),
    pushUpdates: (id, updates) => appendUpdates(context, id, updates),
    compact: (id, body) => compactDocument(context, id, body),
    unwrapDek: (document) => openDocumentDek(context, document),
    listMeta: () => listDocumentsMeta(context),
    reportAttachments: async (id, ids) => {
      await putAttachmentReferences(context, id, ids);
    },
  };
}

export * from './records';
export * from './api';
export * from './crypto';
export * from './content';
export * from './sync';
export * from './split';
export * from './summaries';
export * from './outline';
export * from './pagination';
export * from './miniature';
