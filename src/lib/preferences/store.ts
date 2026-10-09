import { ApiError } from '@/lib/api';
import type { AuthedContext } from '@/lib/context';
import { bytesToUtf8, utf8ToBytes, zeroBytes } from '@/lib/encoding';
import { refreshKeyrings } from '@/lib/keyrings/api';
import { parseRegionalPreferences, type RegionalPreferences } from '@/lib/regional';
import { openBlob, sealBlob } from '@/lib/sealed';
import type { SessionKeystore } from '@/lib/session';
import { PREFERENCES_SCOPE, getPreferencesRecord, putPreferencesRecord, type PreferencesRecord } from './api';

export const PREFERENCES_VERSION = 1;
export const MAX_PREFERENCES_ATTEMPTS = 4;

export interface StoredPreferences {
  version: number;
  regional: RegionalPreferences;
}

export interface LoadedPreferences {
  preferences: StoredPreferences;
  revision: number;
  stored: boolean;
}

interface SessionEntry {
  loaded?: LoadedPreferences;
  listeners: Set<(preferences: StoredPreferences) => void>;
}

const sessions = new WeakMap<SessionKeystore, SessionEntry>();

function entry(session: SessionKeystore): SessionEntry {
  let found = sessions.get(session);
  if (found === undefined) {
    const created: SessionEntry = { listeners: new Set() };
    session.onLock(() => {
      created.loaded = undefined;
    });
    sessions.set(session, created);
    found = created;
  }
  return found;
}

export function parseStoredPreferences(value: unknown, fallbackCountry: string): StoredPreferences {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return { version: PREFERENCES_VERSION, regional: parseRegionalPreferences(record.regional, fallbackCountry) };
}

async function documentsKek(context: AuthedContext, generation: number): Promise<Uint8Array> {
  if (!context.session.hasKek(PREFERENCES_SCOPE, generation)) {
    await refreshKeyrings(context);
  }
  return context.session.kek(PREFERENCES_SCOPE, generation);
}

async function openRecord(
  context: AuthedContext,
  record: PreferencesRecord,
  fallbackCountry: string,
): Promise<StoredPreferences> {
  const dek = await openBlob(record.wrapped_dek, await documentsKek(context, record.key_generation));
  try {
    const plaintext = await openBlob(record.ciphertext, dek);
    try {
      return parseStoredPreferences(JSON.parse(bytesToUtf8(plaintext)), fallbackCountry);
    } catch {
      return parseStoredPreferences(undefined, fallbackCountry);
    } finally {
      zeroBytes(plaintext);
    }
  } finally {
    zeroBytes(dek);
  }
}

async function sealPreferences(context: AuthedContext, preferences: StoredPreferences) {
  const { generation, kek } = context.session.currentKek(PREFERENCES_SCOPE);
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const plaintext = utf8ToBytes(JSON.stringify(preferences));
  try {
    return {
      ciphertext: await sealBlob(plaintext, dek),
      wrapped_dek: await sealBlob(dek, kek),
      key_generation: generation,
    };
  } finally {
    zeroBytes(dek, plaintext);
  }
}

function publish(session: SessionKeystore, loaded: LoadedPreferences): void {
  const holder = entry(session);
  holder.loaded = loaded;
  for (const listener of holder.listeners) {
    listener(loaded.preferences);
  }
}

export function cachedPreferences(session: SessionKeystore): StoredPreferences | undefined {
  return entry(session).loaded?.preferences;
}

export function subscribePreferences(
  session: SessionKeystore,
  listener: (preferences: StoredPreferences) => void,
): () => void {
  const holder = entry(session);
  holder.listeners.add(listener);
  return () => holder.listeners.delete(listener);
}

export async function loadPreferences(
  context: AuthedContext,
  fallbackCountry: string,
  options: { fresh?: boolean } = {},
): Promise<LoadedPreferences> {
  const holder = entry(context.session);
  if (!options.fresh && holder.loaded !== undefined) {
    return holder.loaded;
  }
  const record = await getPreferencesRecord(context);
  const loaded: LoadedPreferences =
    record === undefined
      ? { preferences: parseStoredPreferences(undefined, fallbackCountry), revision: 0, stored: false }
      : { preferences: await openRecord(context, record, fallbackCountry), revision: record.revision, stored: true };
  publish(context.session, loaded);
  return loaded;
}

export async function savePreferences(
  context: AuthedContext,
  fallbackCountry: string,
  edit: (current: StoredPreferences) => StoredPreferences,
): Promise<StoredPreferences> {
  let fresh = entry(context.session).loaded === undefined;
  for (let attempt = 0; attempt < MAX_PREFERENCES_ATTEMPTS; attempt += 1) {
    const loaded = fresh
      ? await loadPreferences(context, fallbackCountry, { fresh: true })
      : (entry(context.session).loaded as LoadedPreferences);
    const next = parseStoredPreferences(edit(loaded.preferences), fallbackCountry);
    try {
      const stored = await putPreferencesRecord(context, {
        ...(await sealPreferences(context, next)),
        expected_revision: loaded.revision,
      });
      publish(context.session, { preferences: next, revision: stored.revision, stored: true });
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.isStaleKeyGeneration) {
        await refreshKeyrings(context);
        fresh = false;
        continue;
      }
      if (error instanceof ApiError && error.status === 409) {
        fresh = true;
        continue;
      }
      throw error;
    }
  }
  throw new Error('the preferences kept changing on another device; try again');
}

export async function resealPreferences(context: AuthedContext, fallbackCountry: string): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_PREFERENCES_ATTEMPTS; attempt += 1) {
    const record = await getPreferencesRecord(context);
    if (record === undefined || record.key_generation >= context.session.currentKek(PREFERENCES_SCOPE).generation) {
      return false;
    }
    const preferences = await openRecord(context, record, fallbackCountry);
    try {
      const stored = await putPreferencesRecord(context, {
        ...(await sealPreferences(context, preferences)),
        expected_revision: record.revision,
      });
      publish(context.session, { preferences, revision: stored.revision, stored: true });
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        if (error.isStaleKeyGeneration) {
          await refreshKeyrings(context);
        }
        continue;
      }
      throw error;
    }
  }
  throw new Error('the preferences kept changing on another device; try again');
}
