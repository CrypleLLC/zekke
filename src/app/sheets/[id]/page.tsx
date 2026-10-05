'use client';

import { use } from 'react';
import SpreadsheetWorkspace from '@/components/spreadsheets/SpreadsheetWorkspace';
import SessionGate from '@/components/session/SessionGate';

export default function SpreadsheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <SessionGate>
      <SpreadsheetWorkspace id={id} />
    </SessionGate>
  );
}
