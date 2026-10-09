import { beforeAll, describe, expect, it } from 'vitest';
import { TokenStore } from '@/lib/api';
import { completeSignUp, draftSignUp, enrolThisBrowser, type AccountServices } from '@/lib/account';
import type { AuthedContext } from '@/lib/context';
import { memoryDeviceStore } from '@/lib/device/store';
import { Feed, fetchChanges, notesOf, type FeedScope } from '@/lib/feed';
import { generateMnemonic } from '@/lib/keys';
import { createNote, deleteNote, openNote, updateNote } from '@/lib/notes';
import { SessionKeystore } from '@/lib/session';

function services(): AccountServices {
  return {
    session: new SessionKeystore({ idleTimeoutMs: 0 }),
    tokens: new TokenStore(),
    store: memoryDeviceStore(),
  };
}

function context(account: AccountServices): AuthedContext {
  return { session: account.session, tokens: account.tokens, paranoid: false };
}

function countingFeed(ctx: AuthedContext): { feed: Feed; since: number[] } {
  const since: number[] = [];
  const feed = new Feed((scope: FeedScope, from: number, limit: number) => {
    since.push(from);
    return fetchChanges(ctx, scope, from, limit);
  });
  return { feed, since };
}

describe('154 the web app follows the feed', () => {
  let writer: AuthedContext;
  let reader: AuthedContext;

  beforeAll(async () => {
    const mnemonic = generateMnemonic(12);
    const first = services();
    await completeSignUp(first, await draftSignUp(mnemonic), { pin: '482915', paranoid: false });
    const second = services();
    await enrolThisBrowser(second, { mnemonic, pin: '962730' });
    writer = context(first);
    reader = context(second);
  });

  it('shows another browser’s create, edit and delete without listing everything again', async () => {
    const { feed, since } = countingFeed(reader);
    expect(await feed.sync('notes')).toBe(true);
    expect(notesOf(feed.replica('notes'))).toEqual([]);

    const created = await createNote(writer, 'from the other browser');
    expect(await feed.sync('notes')).toBe(true);
    const [arrived] = notesOf(feed.replica('notes'));
    expect(arrived.id).toBe(created.note.id);
    expect(await openNote(reader, arrived)).toBe('from the other browser');

    await updateNote(writer, created.note, 'edited elsewhere');
    await feed.sync('notes');
    expect(await openNote(reader, notesOf(feed.replica('notes'))[0])).toBe('edited elsewhere');

    await deleteNote(writer, created.note.id);
    await feed.sync('notes');
    expect(notesOf(feed.replica('notes'))).toEqual([]);

    expect(since.slice(0, 2)).toEqual([0, 0]);
    expect(since.slice(2).every((cursor) => cursor > 0)).toBe(true);
  });

  it('answers an idle tab with nothing new', async () => {
    const { feed, since } = countingFeed(reader);
    await feed.sync('notes');
    const cursor = feed.replica('notes').cursor;

    expect(await feed.sync('notes')).toBe(false);
    expect(since.at(-1)).toBe(cursor);
  });
});
