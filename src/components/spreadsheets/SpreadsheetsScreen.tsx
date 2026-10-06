'use client';

import { DOCUMENT_SHELVES } from '@/lib/app';
import { DocumentShelfScreen } from '@/components/documents/DocumentsScreen';

export default function SpreadsheetsScreen() {
  return <DocumentShelfScreen shelf={DOCUMENT_SHELVES.spreadsheet} />;
}
