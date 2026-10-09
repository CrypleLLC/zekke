import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTestSession } from '@/test/session';
import type { AuthedContext } from '@/lib/context';
import { sha256Hex, utf8ToBytes } from '@/lib/encoding';
import { countryDefaults } from '@/lib/regional';
import { sealBlob } from '@/lib/sealed';
import { SessionKeystore } from '@/lib/session';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import type { PreferencesRecord } from './api';
import { cachedPreferences, loadPreferences, resealPreferences, savePreferences, subscribePreferences } from './store';

interface FakeServer {
  calls: string[];
  row?: PreferencesRecord;
  bodies: Record<string, unknown>[];
  currentGeneration?: number;
}

function fakeServer(): FakeServer {
  const server: FakeServer = { calls: [], bodies: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init.method ?? 'GET';
      server.calls.push(`${method} ${path}`);
      const answer = (status: number, body?: unknown) =>
        ({
          status,
          ok: status >= 200 && status < 300,
          text: async () => (body === undefined ? '' : JSON.stringify(body)),
          headers: { get: () => null },
        }) as unknown as Response;
      if (path !== '/preferences') {
        return answer(404, { code: 'NOT_FOUND' });
      }
      if (method === 'GET') {
        return server.row ? answer(200, { data: server.row }) : answer(404, { code: 'NOT_FOUND' });
      }
      const body = JSON.parse(String(init.body));
      server.bodies.push(body);
      if (server.currentGeneration !== undefined && body.key_generation !== server.currentGeneration) {
        return answer(409, { code: 'STALE_KEY_GENERATION' });
      }
      if (body.expected_revision !== (server.row?.revision ?? 0)) {
        return answer(409, { code: 'CONFLICT' });
      }
      server.row = {
        ciphertext: body.ciphertext,
        wrapped_dek: body.wrapped_dek,
        key_generation: body.key_generation,
        revision: (server.row?.revision ?? 0) + 1,
        updated_at: new Date().toISOString(),
      };
      return answer(200, { data: server.row });
    }),
  );
  return server;
}

function otherDevice(context: AuthedContext): AuthedContext {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  session.adoptHandoff(context.session.exportForHandoff());
  return { ...context, session };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the account’s preferences', () => {
  it('start from the browser’s country when nothing is stored, without writing', async () => {
    const { context } = await openTestSession();
    const server = fakeServer();

    const loaded = await loadPreferences(context, 'BR');

    expect(loaded).toMatchObject({ stored: false, revision: 0 });
    expect(loaded.preferences.regional).toEqual(countryDefaults('BR'));
    expect(server.calls).toEqual(['GET /preferences']);
  });

  it('are sealed, so the country never reaches the server, and another device opens them', async () => {
    const { context } = await openTestSession();
    const server = fakeServer();

    await savePreferences(context, 'US', (current) => ({ ...current, regional: countryDefaults('BR') }));

    expect(JSON.stringify(server.bodies)).not.toMatch(/BRL|dd\/mm\/yyyy|"BR"/);
    const reopened = await loadPreferences(otherDevice(context), 'US', { fresh: true });
    expect(reopened.preferences.regional).toEqual(countryDefaults('BR'));
    expect(reopened.revision).toBe(1);
  });

  it('are signed over the revision they replace and the digest of the ciphertext', async () => {
    const shared = await openTestSession();
    const server = fakeServer();

    await savePreferences(shared.context, 'US', (current) => current);

    const body = server.bodies[0] as { challenge: string; timestamp: number; signature: string; ciphertext: string };
    const digest = await sha256Hex(utf8ToBytes(body.ciphertext));
    const payload = buildActionPayload(body.challenge, body.timestamp, 'preferences-update', [0, digest]);
    expect(verifyPayload(payload, body.signature, shared.devicePublicKey)).toBe(true);
  });

  it('keep both devices’ changes to different settings after a conflict', async () => {
    const { context } = await openTestSession();
    const other = otherDevice(context);
    const server = fakeServer();

    await savePreferences(context, 'BR', (current) => current);
    await loadPreferences(other, 'BR', { fresh: true });
    await savePreferences(context, 'BR', (current) => ({ ...current, regional: { ...current.regional, measurement: 'imperial' } }));

    const merged = await savePreferences(other, 'BR', (current) => ({
      ...current,
      regional: { ...current.regional, date: 'yyyy-mm-dd' },
    }));

    expect(merged.regional).toMatchObject({ measurement: 'imperial', date: 'yyyy-mm-dd' });
    expect(server.row?.revision).toBe(3);
  });

  it('tell every listener on the device when they change', async () => {
    const { context } = await openTestSession();
    fakeServer();
    await loadPreferences(context, 'BR');
    const heard: string[] = [];
    const stop = subscribePreferences(context.session, (preferences) => heard.push(preferences.regional.date));

    await savePreferences(context, 'BR', (current) => ({ ...current, regional: { ...current.regional, date: 'yyyy-mm-dd' } }));
    stop();
    await savePreferences(context, 'BR', (current) => ({ ...current, regional: { ...current.regional, date: 'dd.mm.yyyy' } }));

    expect(heard).toEqual(['yyyy-mm-dd']);
    expect(cachedPreferences(context.session)?.regional.date).toBe('dd.mm.yyyy');
  });

  it('are re-sealed under the current generation after a rotation, and only then', async () => {
    const { context } = await openTestSession({ generations: { documents: 2 } });
    const server = fakeServer();

    expect(await resealPreferences(context, 'BR')).toBe(false);
    await savePreferences(context, 'BR', (current) => ({ ...current, regional: { ...current.regional, paper: 'letter' } }));
    expect(await resealPreferences(context, 'BR')).toBe(false);

    const dek = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = utf8ToBytes(JSON.stringify({ version: 1, regional: { ...countryDefaults('BR'), paper: 'letter' } }));
    server.row = {
      ...(server.row as PreferencesRecord),
      ciphertext: await sealBlob(plaintext, dek),
      wrapped_dek: await sealBlob(dek, context.session.kek('documents', 1)),
      key_generation: 1,
    };

    expect(await resealPreferences(context, 'BR')).toBe(true);
    expect(server.row?.key_generation).toBe(2);
    const reopened = await loadPreferences(otherDevice(context), 'BR', { fresh: true });
    expect(reopened.preferences.regional.paper).toBe('letter');
  });
});
