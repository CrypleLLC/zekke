import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, CLIENT_HEADER, forgetClientIdentity, identifyClient, request } from '@/lib/api';
import { compareVersions, getClientPolicy, versionNotice, type ClientPolicy } from './index';

function stubFetch(status: number, body?: unknown) {
  const headers: Record<string, string>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      headers.push(init.headers as Record<string, string>);
      const text = body === undefined ? '' : JSON.stringify(body);
      return {
        status,
        ok: status >= 200 && status < 300,
        text: async () => text,
        headers: { get: () => null },
      } as unknown as Response;
    }),
  );
  return headers;
}

afterEach(() => {
  vi.unstubAllGlobals();
  forgetClientIdentity();
});

describe('compareVersions', () => {
  it('orders semantic versions, pre-releases first', () => {
    const ordered = ['0.9.9', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0', '1.0.1', '1.10.0'];
    for (let i = 0; i + 1 < ordered.length; i++) {
      expect(compareVersions(ordered[i], ordered[i + 1]), `${ordered[i]} < ${ordered[i + 1]}`).toBe(-1);
      expect(compareVersions(ordered[i + 1], ordered[i])).toBe(1);
    }
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBeUndefined();
  });
});

describe('versionNotice', () => {
  const policy: ClientPolicy = {
    platform: 'extension',
    min_supported: '1.0.0',
    latest: '1.4.0',
    deprecated_below: '1.2.0',
    deprecation_ends: '2026-12-01T00:00:00Z',
  };

  it('says what a version has to do', () => {
    expect(versionNotice(policy, '0.9.0')).toEqual({ level: 'required', latest: '1.4.0' });
    expect(versionNotice(policy, '1.1.0')).toEqual({ level: 'deprecated', latest: '1.4.0', deprecationEnds: '2026-12-01T00:00:00Z' });
    expect(versionNotice(policy, '1.3.0')).toEqual({ level: 'available', latest: '1.4.0' });
    expect(versionNotice(policy, '1.4.0')).toEqual({ level: 'current' });
    expect(versionNotice({ ...policy, deprecated_below: undefined, deprecation_ends: undefined }, '1.1.0').level).toBe('available');
  });
});

describe('the client header', () => {
  it('is sent only once a client identifies itself', async () => {
    const headers = stubFetch(200, { data: {} });

    await request({ method: 'GET', path: '/x' });
    expect(headers[0][CLIENT_HEADER]).toBeUndefined();

    identifyClient('extension', '0.1.0');
    await request({ method: 'GET', path: '/x' });
    expect(headers[1][CLIENT_HEADER]).toBe('extension/0.1.0');

    expect(() => identifyClient('extension', 'one')).toThrow();
  });

  it('reads a 426 as an upgrade being required', async () => {
    stubFetch(426, { code: 'UPGRADE_REQUIRED' });

    const error = await request({ method: 'GET', path: '/x' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isUpgradeRequired).toBe(true);
  });
});

describe('getClientPolicy', () => {
  it('reads the policy, and has none when the API cannot say', async () => {
    stubFetch(200, { data: { platform: 'extension', min_supported: '0.1.0', latest: '0.2.0' } });
    expect(await getClientPolicy('extension')).toMatchObject({ latest: '0.2.0' });

    stubFetch(404, { code: 'NOT_FOUND' });
    expect(await getClientPolicy('ios')).toBeUndefined();
  });
});
