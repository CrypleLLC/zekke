import * as Y from 'yjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { TokenStore } from '@/lib/api';
import { completeSignUp, draftSignUp, type AccountServices } from '@/lib/account';
import type { AuthedContext } from '@/lib/context';
import { memoryDeviceStore } from '@/lib/device/store';
import { BODY_FRAGMENT, DocumentSync, apiTransport, createDocument } from '@/lib/documents';
import {
  AttachmentImages,
  attachmentKey,
  getAttachmentDownload,
  getAttachmentUsage,
  getSharedAttachment,
  imageAttachmentIds,
  listAttachments,
  openAttachment,
  planImage,
  putAttachmentReferences,
  readAttachmentEntry,
  recallImage,
  uploadPlannedImage,
  writeAttachmentEntry,
  type PlannedImage,
  type PreparedImage,
} from '@/lib/documents/attachments';
import { generateMnemonic } from '@/lib/keys';
import { SessionKeystore } from '@/lib/session';
import {
  acceptInvitation,
  copySharedItem,
  inviteByUsername,
  listConnections,
  listInbox,
  shareItemById,
  type ConnectionRecord,
} from '@/lib/sharing';
import { getMe } from '@/lib/users';

interface Account {
  ctx: AuthedContext;
  username: string;
}

async function signUp(pin: string): Promise<Account> {
  const services: AccountServices = {
    session: new SessionKeystore({ idleTimeoutMs: 0 }),
    tokens: new TokenStore(),
    store: memoryDeviceStore(),
  };
  await completeSignUp(services, await draftSignUp(generateMnemonic(12)), { pin, paranoid: false });
  const ctx = { session: services.session, tokens: services.tokens, paranoid: false };
  return { ctx, username: (await getMe(ctx)).username };
}

async function connectionWith(account: Account, username: string): Promise<ConnectionRecord> {
  const found = (await listConnections(account.ctx)).find((connection) => connection.username === username);
  if (found === undefined) {
    throw new Error(`no connection with ${username}`);
  }
  return found;
}

function pattern(length: number, seed: number): Uint8Array {
  return new Uint8Array(length).map((_, index) => (index * 31 + seed) % 251);
}

async function openSync(account: Account, id: string): Promise<DocumentSync> {
  const sync = new DocumentSync(id, apiTransport(account.ctx), { debounceMs: 0, pollIntervalMs: 0 });
  await sync.open();
  return sync;
}

function imagesFor(account: Account, documentId: string, doc: Y.Doc): AttachmentImages {
  return new AttachmentImages({
    entry: (id) => readAttachmentEntry(doc, id),
    download: (id) => getAttachmentDownload(account.ctx, documentId, id),
  });
}

describe('150 images in documents, against the API and an S3 store', () => {
  let owner: Account;
  let friend: Account;
  let documentId: string;
  let planned: PlannedImage;
  const prepared: PreparedImage = {
    image: { bytes: pattern(200_000, 7), mime: 'image/webp', width: 1600, height: 1200 },
    thumbnail: { bytes: pattern(12_000, 3), mime: 'image/webp', width: 480, height: 360 },
  };

  beforeAll(async () => {
    [owner, friend] = await Promise.all([signUp('529173'), signUp('638204')]);
  });

  it('uploads an image beside its document and opens it on another device', async () => {
    documentId = (await createDocument(owner.ctx)).document.id;
    const writer = await openSync(owner, documentId);

    planned = planImage(prepared);
    writer.doc.transact(() => {
      writeAttachmentEntry(writer.doc, planned.thumbnail.id, planned.thumbnail.entry);
      writeAttachmentEntry(writer.doc, planned.image.id, planned.image.entry);
      const node = new Y.XmlElement('image');
      node.setAttribute('attachment', planned.image.id);
      writer.doc.getXmlFragment(BODY_FRAGMENT).insert(0, [node]);
    });
    await uploadPlannedImage(owner.ctx, documentId, planned, prepared);
    await writer.compact();
    writer.destroy();

    const stored = await listAttachments(owner.ctx, documentId);
    expect(stored.map((row) => row.state)).toEqual(['ok', 'ok']);

    const reader = await openSync(owner, documentId);
    const images = imagesFor(owner, documentId, reader.doc);
    await images.open(planned.image.id);
    expect(new Uint8Array(await recallImage(planned.image.id)!.arrayBuffer())).toEqual(prepared.image.bytes);
    images.close();
    reader.destroy();

    const usage = await getAttachmentUsage(owner.ctx);
    expect(usage.attachment_bytes).toBe(planned.image.entry.stored + planned.thumbnail.entry.stored);
  });

  it('keeps another account out of the attachment', async () => {
    await expect(getAttachmentDownload(friend.ctx, documentId, planned.image.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('lets a recipient read the owner’s image through the share, and copy the document with its images', async () => {
    await inviteByUsername(owner.ctx, friend.username);
    await acceptInvitation(friend.ctx, await connectionWith(friend, owner.username));
    await shareItemById(owner.ctx, await connectionWith(owner, friend.username), 'document', documentId);

    const [share] = (await listInbox(friend.ctx)).filter((item) => item.item_type === 'document');
    const shared = await getSharedAttachment(friend.ctx, share.id, planned.image.id);
    const response = await fetch(shared.url);
    const opened = await openAttachment(
      new Uint8Array(await response.arrayBuffer()),
      attachmentKey(planned.image.entry),
      planned.image.entry.size,
      shared.ciphertext_sha256,
    );
    expect(opened).toEqual(prepared.image.bytes);

    const copied = await copySharedItem(friend.ctx, await connectionWith(friend, owner.username), {
      id: share.id,
      item_type: 'document',
    });

    const copy = await openSync(friend, copied.id);
    const [copiedImage] = imageAttachmentIds(copy.doc);
    expect(copiedImage).not.toBe(planned.image.id);
    const images = imagesFor(friend, copied.id, copy.doc);
    await images.open(copiedImage);
    expect(new Uint8Array(await recallImage(copiedImage)!.arrayBuffer())).toEqual(prepared.image.bytes);
    images.close();
    copy.destroy();

    const usage = await getAttachmentUsage(friend.ctx);
    expect(usage.attachment_bytes).toBe(planned.image.entry.stored + planned.thumbnail.entry.stored);
  });

  it('marks an image removed from the text as unreferenced at the next compaction', async () => {
    const writer = await openSync(owner, documentId);
    writer.doc.transact(() => {
      const body = writer.doc.getXmlFragment(BODY_FRAGMENT);
      body.delete(0, body.length);
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText('no more images')]);
      body.insert(0, [paragraph]);
    });
    await writer.flush();
    await writer.compact();
    writer.destroy();

    const ids = [planned.image.id, planned.thumbnail.id];
    expect(await putAttachmentReferences(owner.ctx, documentId, ids)).toEqual({
      referenced: 2,
      unreferenced: 0,
    });
  });
});
