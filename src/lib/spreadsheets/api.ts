import { createDocumentFromSnapshot, type DocumentsContext } from '@/lib/documents/api';
import type { DocumentRecord } from '@/lib/documents/records';
import { zeroBytes } from '@/lib/encoding';
import { newSpreadsheetSnapshot } from './preview';

export async function createSpreadsheet(context: DocumentsContext): Promise<DocumentRecord> {
  const snapshot = newSpreadsheetSnapshot();
  try {
    return await createDocumentFromSnapshot(context, snapshot);
  } finally {
    zeroBytes(snapshot);
  }
}
