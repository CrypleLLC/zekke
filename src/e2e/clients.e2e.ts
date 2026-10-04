import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, forgetClientIdentity, getBaseUrl, identifyClient, TokenStore } from '@/lib/api';
import { completeSignUp, draftSignUp, type AccountServices } from '@/lib/account';
import { getClientPolicy, versionNotice } from '@/lib/clients';
import type { AuthedContext } from '@/lib/context';
import { memoryDeviceStore } from '@/lib/device/store';
import { generateMnemonic } from '@/lib/keys';
import { SessionKeystore } from '@/lib/session';
import { getMe } from '@/lib/users';

async function signUp(): Promise<AuthedContext> {
  const services: AccountServices = {
    session: new SessionKeystore({ idleTimeoutMs: 0 }),
    tokens: new TokenStore(),
    store: memoryDeviceStore(),
  };
  await completeSignUp(services, await draftSignUp(generateMnemonic(12)), { pin: '482915', paranoid: false });
  return { session: services.session, tokens: services.tokens, paranoid: false };
}

afterEach(() => {
  forgetClientIdentity();
});

describe('the client version policy, against a live API', () => {
  it('publishes the extension’s policy and none for an app not yet released', async () => {
    const policy = await getClientPolicy('extension');
    expect(policy).toBeDefined();
    expect(policy!.platform).toBe('extension');
    expect(versionNotice(policy!, policy!.min_supported).level).not.toBe('required');

    expect(await getClientPolicy('ios')).toBeUndefined();

    const response = await fetch(`${getBaseUrl()}/clients/extension/policy`);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('refuses a version below the minimum with 426, and serves the minimum', async () => {
    const ctx = await signUp();
    const { min_supported: minimum } = (await getClientPolicy('extension'))!;

    identifyClient('extension', '0.0.1');
    const refused = await getMe(ctx).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).isUpgradeRequired).toBe(true);
    expect((refused as ApiError).code).toBe('UPGRADE_REQUIRED');

    identifyClient('extension', minimum);
    expect((await getMe(ctx)).uuid).toBeDefined();

    forgetClientIdentity();
    expect((await getMe(ctx)).uuid).toBeDefined();
  });

  it('never blocks health, readiness or the policy itself', async () => {
    for (const path of ['/health', '/ready', '/clients/extension/policy']) {
      const response = await fetch(`${getBaseUrl()}${path}`, { headers: { 'Zekke-Client': 'extension/0.0.1' } });
      expect(response.status, path).toBe(200);
    }
  });
});
