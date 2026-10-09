'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Doc as YDoc } from 'yjs';
import type { RegionalPreferences, SpreadsheetRegional } from '@/lib/regional';
import { observeSheetRegional, readSheetRegional, writeSheetRegional } from '@/lib/spreadsheets';
import { useRegionalPreferences } from '@/components/session/usePreferences';

export interface SheetRegionalHandle {
  regional: SpreadsheetRegional;
  account: RegionalPreferences;
  loaded: boolean;
  saveRegional: (regional: SpreadsheetRegional) => void;
}

export function useSheetRegional(doc: YDoc): SheetRegionalHandle {
  const { regional: account, loaded } = useRegionalPreferences();
  const [, setRevision] = useState(0);

  useEffect(() => observeSheetRegional(doc, () => setRevision((current) => current + 1)), [doc]);

  const regional = readSheetRegional(doc, account);
  const saveRegional = useCallback((next: SpreadsheetRegional) => writeSheetRegional(doc, next), [doc]);

  return { regional, account, loaded, saveRegional };
}
