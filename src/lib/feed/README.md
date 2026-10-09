# `lib/feed` — following the change feed

The web app's copy of the account's items, kept in memory and brought up to date from
`GET /changes` ([ADR 00022](../../../../api-general/docs/adr/00022_change_feed.md),
[Task 154](../../../../tasks-closed.md#task-154)). A screen that used to list a whole scope on every
load now asks for what changed since the last time — usually nothing, which the API answers from one
row.

| File          | What it holds                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `records.ts`  | The wire shape of a page, the five scopes, the item types                                           |
| `replica.ts`  | `ScopeReplica`: the rows of one scope by type and id, each with the `seq` it arrived at, and the cursor |
| `feed.ts`     | `Feed`: one replica per scope, `sync`, the subscribers, the poll loop                               |
| `api.ts`      | `fetchChanges` and `feedFor(context)`, the one `Feed` of an unlocked session                        |
| `views.ts`    | The records each screen used to fetch, built from the replica, in the order the server listed them  |

## One feed per unlock, in memory only

`feedFor(context)` keeps one `Feed` per `AuthedContext` in a `WeakMap`. `ZekkeProvider` builds a new
context on every unlock, so a lock drops the replica with it and the next unlock pulls every scope
from zero. **Nothing is persisted**: the replica holds ciphertext and wrapped keys, never plaintext,
but IndexedDB keeps exactly its two exemptions (the device record and unfinished upload handles), and
a third is an amendment to ADR 00022, not a change here.

## Applying a page

A change carries the row as its domain serves it, or a tombstone. `ScopeReplica.apply`:

- keeps a row only if its `seq` is above the one held, so the copy of this device's own write that
  comes back, or a page that arrives late, changes nothing;
- removes a row on a tombstone, and remembers the tombstone's `seq` so an older copy cannot bring the
  row back;
- turns `null` fields into absent ones, because every item endpoint omits an empty optional field
  and the records the screens use (`folder_id?`, `parent_id?`) say so.

`sync(scope)` reads pages from the cursor until `more` is false. **One request at a time per scope**:
a call that arrives while a pull is running waits for it and then runs one more pull, shared by every
caller that arrived meanwhile — so a screen that reloads right after its own write always sees it.
A `410 RESET` means the cursor is older than the tombstones the server keeps: the replica is emptied
and pulled from zero, once.

## What a screen sees

| Screen            | Reads                                                          | Was                                   |
| ----------------- | -------------------------------------------------------------- | ------------------------------------- |
| Notes             | `feedNotes` — every note, newest first                         | `GET /notes`, then one `GET` per note |
| Vault             | `feedSecrets`, `feedDeletedSecrets` — split on `deleted_at`    | `GET /secrets`, `GET /secrets/deleted`|
| Passwords         | `feedCredentials` — each credential's highest-`seq` revision, none for a deleted one | `GET /credentials` |
| Documents         | `feedDocumentMetas(folder)` — without `latest_seq`, which the summary reads from the opened document | `GET /documents` |
| Drive             | `feedFiles(folder)` — pending uploads included, so any device can resume one | `GET /files`             |
| Folder trees      | `feedTreeFolders(scope)`, opened by `lib/folders`' `openTreeFolders` | `GET /<scope>/folders`        |

`folder` is `undefined` for everything, `'root'` for items in no folder, or a folder id — the same
values `?folder=` took. Items in the Trash (`deleted_at` set) are left out of every live view; the
Trash screen still reads `GET /…/trash`, which knows the retention window.

**Still listed whole:** a document's summary opens the document (snapshot and log) to read its title
and first page, because a title is CRDT content and edits never move a document in the feed; the
folder manifests of the vault and notes tabs; the Trash; shares and connections, which ADR 00022
keeps out of the feed.

## Staying current: `components/session/useFeed`

- **`useFeedPolling()`**, called once by `AppShell`, syncs every scope the device holds as soon as the
  shell mounts, then polls them every 30 s while the tab is visible, doubling to 120 s while nothing
  changes and back to 30 s on the first change. Hiding the tab stops the loop; showing it syncs at
  once and starts again; coming back online syncs.
- **`useFeedChanges(scope, reload)`** reloads a screen when a sync it did not ask for brought a change
  to its scope. A screen's own read is a quiet sync (`{ notify: false }`), so loading never triggers
  a second load.

An idle signed-in tab therefore costs one `GET /changes` per held scope per poll, each answered by
the API from `sync_heads` without touching an item table.

## Tests

`feed.test.ts` — the replica (newest wins, tombstones, a late older copy, nulls), the feed (zero then
the cursor, every page, `RESET`, one request at a time with a follow-up pull, quiet reads, the poll's
back-off and stop) and every view (order, Trash, folders, the newest credential revision, a tree's
order). `src/e2e/feed.e2e.ts` runs a create, an edit and a delete on one browser and reads them on a
second, by cursor, against a live API.
