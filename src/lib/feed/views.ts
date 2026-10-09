import type { AuthedContext } from '@/lib/context';
import type { CredentialSummary } from '@/lib/credentials';
import type { DocumentMetaRecord } from '@/lib/documents/records';
import type { FileRecord } from '@/lib/files/records';
import type { TreeFolderRecord } from '@/lib/folders/tree';
import type { NoteRecord } from '@/lib/notes';
import type { DeletedSecretRecord, SecretRecord } from '@/lib/secrets';
import { feedFor } from './api';
import type { ScopeReplica } from './replica';

interface Deletable {
  deleted_at?: string;
}

interface CredentialRevision extends CredentialSummary {
  deleted: boolean;
}

export type FolderFilter = string | undefined;

export const ROOT_FOLDER = 'root';

function byNewest<T extends { created_at: string; id: string }>(left: T, right: T): number {
  return right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);
}

function live<T extends Deletable>(rows: T[]): T[] {
  return rows.filter((row) => row.deleted_at === undefined);
}

function inFolder<T extends { folder_id?: string }>(rows: T[], folder: FolderFilter): T[] {
  if (folder === undefined) {
    return rows;
  }
  return rows.filter((row) => (folder === ROOT_FOLDER ? row.folder_id === undefined : row.folder_id === folder));
}

function strip<T>(row: T & Deletable): T {
  const { deleted_at: _deleted, ...rest } = row;
  return rest as T;
}

export function notesOf(replica: ScopeReplica): NoteRecord[] {
  return replica.items<NoteRecord>('note').sort(byNewest);
}

export function secretsOf(replica: ScopeReplica): SecretRecord[] {
  return live(replica.items<SecretRecord & Deletable>('secret'))
    .sort(byNewest)
    .map((row) => strip<SecretRecord>(row));
}

export function deletedSecretsOf(replica: ScopeReplica): DeletedSecretRecord[] {
  return replica
    .items<DeletedSecretRecord>('secret')
    .filter((row) => row.deleted_at !== undefined)
    .sort((left, right) => right.deleted_at.localeCompare(left.deleted_at) || left.id.localeCompare(right.id));
}

export function currentCredentialsOf(replica: ScopeReplica): CredentialSummary[] {
  const newest = new Map<string, CredentialRevision>();
  for (const revision of replica.items<CredentialRevision>('credential')) {
    const held = newest.get(revision.credential_id);
    if (held === undefined || revision.seq > held.seq) {
      newest.set(revision.credential_id, revision);
    }
  }
  return [...newest.values()]
    .filter((revision) => !revision.deleted)
    .sort((left, right) => right.seq - left.seq)
    .map(({ deleted: _deleted, ...summary }) => summary);
}

export function filesOf(replica: ScopeReplica, folder?: FolderFilter): FileRecord[] {
  return inFolder(live(replica.items<FileRecord & Deletable>('file')), folder)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .map((row) => strip<FileRecord>(row));
}

export function documentMetasOf(replica: ScopeReplica, folder?: FolderFilter): DocumentMetaRecord[] {
  return inFolder(live(replica.items<DocumentMetaRecord & Deletable>('document')), folder)
    .sort(byNewest)
    .map((row) => strip<DocumentMetaRecord>(row));
}

export function treeFoldersOf(replica: ScopeReplica, type: 'document_folder' | 'file_folder'): TreeFolderRecord[] {
  return live(replica.items<TreeFolderRecord & Deletable>(type))
    .sort(
      (left, right) =>
        compareParents(left.parent_id, right.parent_id) ||
        left.position - right.position ||
        left.created_at.localeCompare(right.created_at) ||
        left.id.localeCompare(right.id),
    )
    .map((row) => strip<TreeFolderRecord>(row));
}

function compareParents(left: string | undefined, right: string | undefined): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined) {
    return -1;
  }
  if (right === undefined) {
    return 1;
  }
  return left.localeCompare(right);
}

export async function feedNotes(context: AuthedContext): Promise<NoteRecord[]> {
  const feed = feedFor(context);
  await feed.sync('notes', { notify: false });
  return notesOf(feed.replica('notes'));
}

export async function feedSecrets(context: AuthedContext): Promise<SecretRecord[]> {
  const feed = feedFor(context);
  await feed.sync('secrets', { notify: false });
  return secretsOf(feed.replica('secrets'));
}

export async function feedDeletedSecrets(context: AuthedContext): Promise<DeletedSecretRecord[]> {
  const feed = feedFor(context);
  await feed.sync('secrets', { notify: false });
  return deletedSecretsOf(feed.replica('secrets'));
}

export async function feedCredentials(context: AuthedContext): Promise<CredentialSummary[]> {
  const feed = feedFor(context);
  await feed.sync('passwords', { notify: false });
  return currentCredentialsOf(feed.replica('passwords'));
}

export async function feedFiles(context: AuthedContext, folder?: FolderFilter): Promise<FileRecord[]> {
  const feed = feedFor(context);
  await feed.sync('files', { notify: false });
  return filesOf(feed.replica('files'), folder);
}

export async function feedDocumentMetas(context: AuthedContext, folder?: FolderFilter): Promise<DocumentMetaRecord[]> {
  const feed = feedFor(context);
  await feed.sync('documents', { notify: false });
  return documentMetasOf(feed.replica('documents'), folder);
}

export async function feedTreeFolders(context: AuthedContext, scope: 'documents' | 'files'): Promise<TreeFolderRecord[]> {
  const feed = feedFor(context);
  await feed.sync(scope, { notify: false });
  return treeFoldersOf(feed.replica(scope), scope === 'documents' ? 'document_folder' : 'file_folder');
}
