import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Direction } from '@univerjs/core';
import { InsertRowCommand, SetRangeValuesCommand } from '@univerjs/sheets';
import { TokenStore } from '@/lib/api';
import { completeSignUp, draftSignUp, enrolThisBrowser, type AccountServices } from '@/lib/account';
import type { AuthedContext } from '@/lib/context';
import { memoryDeviceStore } from '@/lib/device/store';
import {
  DocumentSync,
  apiTransport,
  compactForAnchor,
  listDocumentsMeta,
  loadDocumentSummaries,
} from '@/lib/documents';
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
import { SPREADSHEET_SYNC_OPTIONS, createSpreadsheet } from '@/lib/spreadsheets';
import { getMe } from '@/lib/users';
import { UNIT, cellText, device, disposeDevices, rowRange, univerView, type Device } from '@/test/spreadsheets';

interface Browser {
  services: AccountServices;
  ctx: AuthedContext;
}

function newBrowser(): Browser {
  const services: AccountServices = {
    session: new SessionKeystore({ idleTimeoutMs: 0 }),
    tokens: new TokenStore(),
    store: memoryDeviceStore(),
  };
  return { services, ctx: { session: services.session, tokens: services.tokens, paranoid: false } };
}

async function signUp(pin: string): Promise<{ browser: Browser; mnemonic: string; username: string }> {
  const mnemonic = generateMnemonic(12);
  const browser = newBrowser();
  await completeSignUp(browser.services, await draftSignUp(mnemonic), { pin, paranoid: false });
  return { browser, mnemonic, username: (await getMe(browser.ctx)).username };
}

async function connectionWith(ctx: AuthedContext, username: string): Promise<ConnectionRecord> {
  const found = (await listConnections(ctx)).find((connection) => connection.username === username);
  if (found === undefined) {
    throw new Error(`no connection with ${username}`);
  }
  return found;
}

const opened: DocumentSync[] = [];

async function openSpreadsheet(ctx: AuthedContext, id: string): Promise<{ sync: DocumentSync; editor: Device }> {
  const sync = new DocumentSync(id, apiTransport(ctx), { ...SPREADSHEET_SYNC_OPTIONS, debounceMs: 0, pollIntervalMs: 0 });
  await sync.open();
  opened.push(sync);
  return { sync, editor: device(sync.doc) };
}

async function save(side: { sync: DocumentSync; editor: Device }): Promise<void> {
  side.editor.binding.settle();
  await side.sync.flush();
}

async function receive(side: { sync: DocumentSync; editor: Device }): Promise<void> {
  await side.sync.pull();
  side.editor.binding.settle();
}

afterAll(() => {
  disposeDevices();
  for (const sync of opened) {
    sync.destroy();
  }
});

describe('147.7 a spreadsheet created, edited on two devices, shared and copied', () => {
  let owner: Awaited<ReturnType<typeof signUp>>;
  let laptop: Browser;
  let recipient: Awaited<ReturnType<typeof signUp>>;
  let id: string;

  beforeAll(async () => {
    [owner, recipient] = await Promise.all([signUp('731942'), signUp('842053')]);
    laptop = newBrowser();
    await enrolThisBrowser(laptop.services, { mnemonic: owner.mnemonic, pin: '731942' });
    await inviteByUsername(owner.browser.ctx, recipient.username);
    await acceptInvitation(recipient.browser.ctx, await connectionWith(recipient.browser.ctx, owner.username));
  });

  it('is created with its first sheet, and listed as a spreadsheet', async () => {
    id = (await createSpreadsheet(owner.browser.ctx)).id;
    const metas = await listDocumentsMeta(owner.browser.ctx);
    const [summary] = await loadDocumentSummaries(owner.browser.ctx, metas.filter((meta) => meta.id === id));
    expect(summary).toMatchObject({ kind: 'spreadsheet', readable: true });
  });

  it('converges when two devices of the account edit it', async () => {
    const phone = await openSpreadsheet(owner.browser.ctx, id);
    await phone.editor.commands.executeCommand(SetRangeValuesCommand.id, {
      unitId: UNIT,
      subUnitId: phone.editor.sheetId,
      range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 },
      value: [
        [{ v: 'Rent' }, { v: 1200 }],
        [{ v: 'Food' }, { v: 450.5 }],
        [{ v: 'Total' }, { f: '=SUM(B1:B2)' }],
      ],
    });
    await save(phone);

    const desk = await openSpreadsheet(laptop.ctx, id);
    expect(univerView(desk.editor)).toBe(univerView(phone.editor));

    await desk.editor.commands.executeCommand(InsertRowCommand.id, {
      unitId: UNIT,
      subUnitId: desk.editor.sheetId,
      range: rowRange(desk.editor, 1),
      direction: Direction.UP,
    });
    await desk.editor.commands.executeCommand(SetRangeValuesCommand.id, {
      unitId: UNIT,
      subUnitId: desk.editor.sheetId,
      range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 1 },
      value: [[{ v: 'Transport' }, { v: 80 }]],
    });
    await save(desk);
    await receive(phone);

    expect(univerView(phone.editor)).toBe(univerView(desk.editor));
    expect(cellText(phone.editor, 3, 1)).toBe('=SUM(B1:B3)');
  });

  it('is shared with what was last written, and copied into the recipient’s account as a spreadsheet', async () => {
    await compactForAnchor(owner.browser.ctx, id);
    await shareItemById(owner.browser.ctx, await connectionWith(owner.browser.ctx, recipient.username), 'document', id);
    const arrived = (await listInbox(recipient.browser.ctx)).find((share) => share.item_id === id);
    expect(arrived).toBeDefined();

    const copy = await copySharedItem(
      recipient.browser.ctx,
      await connectionWith(recipient.browser.ctx, owner.username),
      { id: arrived!.id, item_type: 'document' },
    );
    const metas = await listDocumentsMeta(recipient.browser.ctx);
    const [summary] = await loadDocumentSummaries(recipient.browser.ctx, metas.filter((meta) => meta.id === copy.id));
    expect(summary).toMatchObject({ kind: 'spreadsheet', readable: true });

    const original = await openSpreadsheet(owner.browser.ctx, id);
    const copied = await openSpreadsheet(recipient.browser.ctx, copy.id);
    expect(univerView(copied.editor)).toBe(univerView(original.editor));
    expect(cellText(copied.editor, 1, 0)).toBe('Transport');
  });
});
