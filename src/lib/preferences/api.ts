import { ApiError, request } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';
import { sha256Hex, utf8ToBytes } from '@/lib/encoding';
import { signActionEnvelope } from '@/lib/signing';

export const PREFERENCES_SCOPE = 'documents';

export interface PreferencesRecord {
  ciphertext: string;
  wrapped_dek: string;
  key_generation: number;
  revision: number;
  updated_at: string;
}

export interface PutPreferencesInput {
  ciphertext: string;
  wrapped_dek: string;
  key_generation: number;
  expected_revision: number;
}

export async function getPreferencesRecord(context: AuthedContext): Promise<PreferencesRecord | undefined> {
  try {
    const response = await request<PreferencesRecord>({
      method: 'GET',
      path: '/preferences',
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
    });
    return response.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
}

export async function putPreferencesRecord(context: AuthedContext, input: PutPreferencesInput): Promise<PreferencesRecord> {
  const digest = await sha256Hex(utf8ToBytes(input.ciphertext));
  const response = await request<PreferencesRecord>({
    method: 'PUT',
    path: '/preferences',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: {
      ...input,
      ...(await signActionEnvelope('preferences-update', [input.expected_revision, digest], context.session.signer())),
    },
  });
  return response.data;
}
