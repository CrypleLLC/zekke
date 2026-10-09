'use client';

import { useCallback, useEffect, useState } from 'react';
import { cachedPreferences, loadPreferences, savePreferences, subscribePreferences } from '@/lib/preferences';
import { browserCountry, countryDefaults, type RegionalPreferences } from '@/lib/regional';
import { useAuthedContext } from './ZekkeProvider';

export interface RegionalPreferencesHandle {
  regional: RegionalPreferences;
  loaded: boolean;
  saveRegional: (edit: (current: RegionalPreferences) => RegionalPreferences) => Promise<void>;
}

export function useRegionalPreferences(): RegionalPreferencesHandle {
  const context = useAuthedContext();
  const [regional, setRegional] = useState<RegionalPreferences>(
    () => cachedPreferences(context.session)?.regional ?? countryDefaults(browserCountry()),
  );
  const [loaded, setLoaded] = useState(() => cachedPreferences(context.session) !== undefined);

  useEffect(() => {
    let cancelled = false;
    const stop = subscribePreferences(context.session, (preferences) => {
      if (!cancelled) {
        setRegional(preferences.regional);
        setLoaded(true);
      }
    });
    loadPreferences(context, browserCountry()).catch(() => {
      if (!cancelled) {
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [context]);

  const saveRegional = useCallback(
    async (edit: (current: RegionalPreferences) => RegionalPreferences) => {
      await savePreferences(context, browserCountry(), (current) => ({ ...current, regional: edit(current.regional) }));
    },
    [context],
  );

  return { regional, loaded, saveRegional };
}
