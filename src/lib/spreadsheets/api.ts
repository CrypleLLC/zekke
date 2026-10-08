import { createDocumentFromSnapshot, type DocumentsContext } from '@/lib/documents/api';
import type { DocumentRecord } from '@/lib/documents/records';
import { zeroBytes } from '@/lib/encoding';
import type { SpreadsheetRegional } from '@/lib/regional';
import { newSpreadsheetSnapshot } from './preview';

export async function createSpreadsheet(context: DocumentsContext, regional?: SpreadsheetRegional): Promise<DocumentRecord> {
  const snapshot = newSpreadsheetSnapshot(regional);
  try {
    return await createDocumentFromSnapshot(context, snapshot);
  } finally {
    zeroBytes(snapshot);
  }
}
