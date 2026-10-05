import { ApiError, assertCanonicalUuid, request } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';
import {
  MAX_COPY_BATCH,
  type AttachmentDownloadRecord,
  type AttachmentRecord,
  type AttachmentReferencesResult,
  type AttachmentUsage,
  type CopyAttachmentPair,
  type CreatedAttachmentRecord,
  type SharedAttachmentRecord,
} from './records';

function attachmentsPath(documentId: string, suffix = ''): string {
  return `/documents/${assertCanonicalUuid(documentId)}/attachments${suffix}`;
}

export interface CreateAttachmentResult {
  attachment: CreatedAttachmentRecord;
  created: boolean;
}

export async function createAttachment(
  context: AuthedContext,
  documentId: string,
  body: { id: string; size_bytes: number },
): Promise<CreateAttachmentResult> {
  if (!Number.isInteger(body.size_bytes) || body.size_bytes < 1) {
    throw new Error(`size_bytes must be a positive integer, got ${body.size_bytes}`);
  }

  const response = await request<CreatedAttachmentRecord>({
    method: 'POST',
    path: attachmentsPath(documentId),
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { id: assertCanonicalUuid(body.id), size_bytes: body.size_bytes },
  });

  return { attachment: response.data, created: response.status === 201 };
}

export async function completeAttachment(
  context: AuthedContext,
  documentId: string,
  id: string,
  ciphertextSha256: string,
): Promise<AttachmentRecord> {
  if (!/^[0-9a-f]{64}$/.test(ciphertextSha256)) {
    throw new Error('ciphertext_sha256 must be 64 lowercase hex characters');
  }

  const response = await request<AttachmentRecord>({
    method: 'PATCH',
    path: attachmentsPath(documentId, `/${assertCanonicalUuid(id)}`),
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { ciphertext_sha256: ciphertextSha256 },
  });

  return response.data;
}

export async function abandonAttachment(
  context: AuthedContext,
  documentId: string,
  id: string,
): Promise<void> {
  try {
    await request<void>({
      method: 'DELETE',
      path: attachmentsPath(documentId, `/${assertCanonicalUuid(id)}/upload`),
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
    });
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

export async function getAttachmentDownload(
  context: AuthedContext,
  documentId: string,
  id: string,
): Promise<AttachmentDownloadRecord> {
  const response = await request<AttachmentDownloadRecord>({
    method: 'GET',
    path: attachmentsPath(documentId, `/${assertCanonicalUuid(id)}`),
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function listAttachments(
  context: AuthedContext,
  documentId: string,
): Promise<AttachmentRecord[]> {
  const response = await request<AttachmentRecord[]>({
    method: 'GET',
    path: attachmentsPath(documentId),
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function putAttachmentReferences(
  context: AuthedContext,
  documentId: string,
  ids: readonly string[],
): Promise<AttachmentReferencesResult> {
  const response = await request<AttachmentReferencesResult>({
    method: 'PUT',
    path: attachmentsPath(documentId, '/references'),
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { ids: ids.map((id) => assertCanonicalUuid(id)) },
  });
  return response.data;
}

export async function getAttachmentUsage(context: AuthedContext): Promise<AttachmentUsage> {
  const response = await request<AttachmentUsage>({
    method: 'GET',
    path: '/documents/attachments/usage',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function getSharedAttachment(
  context: AuthedContext,
  shareId: string,
  id: string,
): Promise<SharedAttachmentRecord> {
  const response = await request<SharedAttachmentRecord>({
    method: 'GET',
    path: `/shares/${assertCanonicalUuid(shareId)}/attachments/${assertCanonicalUuid(id)}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function copySharedAttachments(
  context: AuthedContext,
  shareId: string,
  documentId: string,
  pairs: readonly CopyAttachmentPair[],
): Promise<AttachmentRecord[]> {
  const copied: AttachmentRecord[] = [];

  for (let start = 0; start < pairs.length; start += MAX_COPY_BATCH) {
    const batch = pairs.slice(start, start + MAX_COPY_BATCH);
    const response = await request<{ attachments: AttachmentRecord[] }>({
      method: 'POST',
      path: `/shares/${assertCanonicalUuid(shareId)}/attachments/copy`,
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      body: {
        document_id: assertCanonicalUuid(documentId),
        attachments: batch.map((pair) => ({
          source_id: assertCanonicalUuid(pair.source_id),
          id: assertCanonicalUuid(pair.id),
        })),
      },
    });
    copied.push(...response.data.attachments);
  }

  return copied;
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
