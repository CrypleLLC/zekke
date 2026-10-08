'use client';

import type { ReactNode } from 'react';
import { setActiveRegional } from '@/lib/regional';
import { useRegionalPreferences } from './usePreferences';

export default function RegionalScope({ children }: { children: ReactNode }) {
  const { regional } = useRegionalPreferences();
  setActiveRegional(regional);
  return <>{children}</>;
}
