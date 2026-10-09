# `lib/documents` — rich-text documents as an encrypted CRDT log

Backs the Google-Docs-style editor at `/docs/[id]`. A document is a **Yjs CRDT**: one compacted
snapshot plus an append-only log of sealed deltas, all produced and consumed here. The server
assigns sequence numbers, appends, and serves ranges. It never parses a delta and never merges
anything — see
[`documents/README.md`](../../../../api-general/internal/domain/documents/README.md) in the API
repo for the wire contract this module implements.

Single user, many devices. No collaboration, no presence, no WebSocket.

## Why a CRDT rather than the `notes` shape

`lib/notes` writes one whole `ciphertext` per save: last write wins, and a phone holding a stale
buffer silently overwrites what the laptop wrote. That is tolerable for a short note and not for
long-form writing.

Operational Transformation cannot help here — it resolves concurrent edits by reading their
positions and content, and the server holds only ciphertext. A CRDT merges by construction, with
no server intelligence at all, which is exactly what a zero-knowledge backend can host.

Three Yjs properties keep the server dumb, and each one buys this module a simplification:

| Property               | What it buys                                                    |
| ---------------------- | --------------------------------------------------------------- |
| Commutative            | `seq` is a **cursor**, not a correctness-bearing order          |
| Idempotent             | Re-applying a delta is a no-op, so over-fetching is always safe |
| Self-describing binary | Nothing inspects a delta, here or on the server                 |

Sync is on `seq`, never on a Yjs state vector. A state vector is plaintext structural metadata —
client count and per-client operation counts — so sending one would leak document structure for
no gain.

## Files

| File            | Role                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `records.ts`    | Wire types, server ceilings, and the contiguity rules                 |
| `api.ts`        | The nine endpoints, DEK wrapping, and the `document-delete` signature |
| `crypto.ts`     | Sealing deltas and snapshots under the per-document DEK               |
| `content.ts`    | The `Y.Doc` layout: `body`, `meta.title`, `meta.font`, `meta.margins` |
| `sync.ts`       | `DocumentSync` — the engine: open, pull, poll, debounce, push, compact, wait on a `429` |
| `summaries.ts`  | Decrypting enough of each document to render the dashboard list       |
| `outline.ts`    | Headings out of a ProseMirror document, nested into a tree            |
| `pagination.ts` | Where the page breaks fall, given block heights                       |
| `split.ts`      | Splitting one Yjs update into several that each fit in a delta        |
| `miniature.ts`  | The beginning of a document, as the Documents screen draws its first page |
| `attachments/`  | Images: their keys, objects, upload and opening ([README](attachments/README.md)) |

## Sealing

Deltas and snapshots are **binary**, so they use `sealBlob` / `openBlob` from
[`lib/sealed`](../sealed/README.md) directly — not `sealText`, which is what `lib/notes` uses.
The DEK is per document and wrapped under the current `documents` scope KEK, with the row's
`key_generation`, by `scopeDekWrapper` ([`lib/keyrings`](../keyrings/README.md)), the same seam
every item domain uses. Re-wrapping a document under a newer generation is `PUT /documents/keys`,
a signed batch shared with the other item domains ([`lib/keyrings`](../keyrings/README.md)). `createDocumentFromSnapshot` creates a document from a snapshot, which is how a
shared document is copied into the recipient's account.

**One DEK seals the snapshot and every delta**, so one wrapped key covers the whole log however
long it grows. It is also why rotating a document's DEK means re-encrypting everything — compact
first, then rotate.

## The two cursor traps

Both of these produce silent, permanent data loss rather than an error, and both have tests.

### `seq` restarts after a full prune

`seq` is `MAX(seq) + 1` **over the remaining rows**. Prune the whole log during compaction and
the next append is `seq = 1` again — _below_ the `snapshot_seq` it follows. A client that opens
at `cursor = snapshot_seq` will therefore never see it.

`DocumentSync` opens at **`cursor = 0`** and pulls the whole surviving log, re-applying anything
the snapshot already covers. That is free correctness: Yjs updates are idempotent. The same reset
happens after this device compacts, and after `refreshHead`.

Because the log may legitimately start above `0` (a partial prune) or restart at `1` (a full
one), a cold pull cannot demand that the first row equals `cursor + 1`. `assertLogFollows` encodes
what is actually true: the first surviving row is either `1` or `snapshot_seq + 1`.

**What the snapshot already holds is counted from where the log starts, not from
`snapshot_seq`.** A cold pull records `logBase`, one below the first surviving row — `snapshot_seq`
when the log continues, `0` when it restarted (and `0` when it is empty, since the next append will
be `1`). Compaction is due on `cursor − logBase` deltas, and has nothing to do when
`cursor ≤ logBase`. Until 2026-10-05 both compared the cursor with `snapshot_seq`, so after a full
prune a document waited for its new log to pass the old `snapshot_seq` before it compacted again —
twice the threshold the first time, more each time after. `compacting after the log restarted` in
`documents.test.ts` pins it.

### `latest_seq` from an append is not a cursor

`POST /updates` returns the log's new `latest_seq`. Treating it as "everything I have seen" is
wrong whenever another device appended in between — those rows sit below it, unread, and the
cursor jumps straight past them.

`cursorAfterAppend` only advances when `latest_seq === cursor + applied`, which is exactly the
case where the only new rows are the ones this device just wrote. Otherwise the cursor stands and
the next pull re-reads the range, harmlessly.

## Contiguity, and why it is a client obligation

`docs/storage-plan.md` used to call for sequence numbers in AES-GCM AAD so a compromised backend
could not reorder chunks, which the frozen sealed-blob format in `docs/crypto/ECDSA.md` makes
impossible — it specifies **no AAD**. **That contradiction was resolved on 2026-09-06**: the drive
now binds a chunk's position inside the _authenticated plaintext_ (`storage-plan.md` § 3.3), which
GCM covers just as AAD would have.

**It does not resolve anything here, and the obligation below stands.** That fix applies to the
chunks of one file object, sealed under one DEK and written once. A document's delta log is a
different shape — an append-only series of independently sealed rows, written by several devices
over time — so there is no chunk count to bind and no single object whose hash could reveal a
missing row. For Yjs, reordering is harmless anyway: merges commute. **Dropping is not.**

So the client verifies it: `assertContiguous` rejects a hole inside any fetched range, and a
detected gap latches `gapDetected` on the sync state. Once latched, `compact()` refuses — writing
a snapshot over an incomplete merge would make the loss permanent by pruning the very rows that
could still have arrived.

## Compaction

Only a client can compact: the server cannot merge an encrypted log. A document nobody opens
never compacts and its log grows — inherent to encrypted CRDT logs, not a defect. Compaction is
for speed and space, never correctness: a snapshot plus any log rebuilds the same document, it is
just slower to open and larger to store as the log grows.

**There are two lifecycles.** By default `DocumentSync.close()` flushes, then compacts if
`shouldCompact()` says so. That is what spreadsheets run.

**The document editor compacts while open instead** (`DOCUMENT_SYNC_OPTIONS`: `compactWhileOpen`,
`compactThreshold: 200`). `close()` runs only when the editor unmounts inside the app — going back
to the vault, opening another document. Closing the tab, reloading, or a phone killing a
background tab runs no unmount and aborts whatever is in flight, so compacting on close would in
practice almost never happen. With `compactWhileOpen` the engine checks after every flush that
pushed something, and once on `open()`, and compacts as soon as the log reaches the threshold and
nothing is pending — so the count restarts from the new snapshot, and a document left at 250
deltas by a tab that was simply closed is folded the next time anyone opens it. `close()` then
only flushes. A compaction already running is never started twice, and its failure is swallowed:
the next push or the next open tries again.

**Why 200.** The threshold decides how often the whole document is re-uploaded, not what a client
can take: 200 deltas are a few hundred KB at most, one request (the transport asks `/updates` for
pages of `MAX_PAGE_LIMIT`, 200, the server's maximum) and milliseconds to apply. With the 3 s
debounce and the 8 s cap, someone writing produces roughly 5–15 appends a minute, so 200 is one
compaction every ~13–40 minutes of writing — rare enough that a document of several MB is not
re-sent every few minutes, small enough that opening is always fast.

`expected_revision` guards the install. A `409 CONFLICT` means another device wrote first, so the
engine re-reads the head and drops its own compaction attempt rather than retrying into a race.
The failure it prevents is **staleness, not simultaneity**: appends are immune by construction,
snapshot installs are not.

### When to compact, and the snapshot ceiling

By default `shouldCompact` is the count rule: `compactThreshold` deltas past the snapshot
(`DEFAULT_COMPACT_THRESHOLD`, 64; the document editor sets 200).
`compactLogRatio` and `compactMinLogBytes` add a **size rule**: compact once the log holds at least
`max(compactMinLogBytes, compactLogRatio × snapshotBytes)` bytes. Compacting re-uploads the whole
snapshot, so for a large item the count rule spends megabytes to fold kilobytes; the ratio keeps the
upload in proportion to what it folds. Spreadsheets use it (`SPREADSHEET_SYNC_OPTIONS` in
[`lib/spreadsheets`](../spreadsheets/README.md#capacity)) and compact on close; documents keep the
count rule, at 200, while open.

The engine tracks `snapshotBytes` (the plaintext snapshot it opened or installed) and `logBytes`
(every delta since, pulled or pushed) in its state; `estimatedBytes()` is their sum.

**A snapshot is checked before it is sent.** `MAX_SNAPSHOT_CHARACTERS` is the documents body limit
(`DOCUMENT_MAX_BODY_BYTES`, 8 MiB) less 1 KiB for the JSON around it. `compact()` seals, records
`sealedSnapshotCharacters` and `capacity` in the state — `near` above 85 % of the ceiling, `over`
above it — and on `over` throws `SnapshotTooLargeError` without calling the server. An item that is
`over` can still be edited, because deltas are small, but stops compacting until it is reopened;
the screen has to say so.

## Debounce is a storage decision

The sealed-blob envelope costs 29 bytes per seal (`0x01 ‖ iv(12) ‖ tag(16)`). Sealing every
keystroke makes envelope overhead dominate the payload, so the engine merges queued updates and
pushes on a 3 s debounce. It was 1.5 s: the longer quiet merges more of a writer's short pauses
into one append, at the cost of a red save dot that lasts a little longer.

The debounce is capped: **no change waits more than 8 s** (`DEFAULT_MAX_WAIT_MS`, the
`maxWaitMs` option, never less than the debounce). A plain trailing debounce restarts on every
keystroke, so someone typing without a 3 s pause would push nothing at all until they
stopped, and a crashed tab or a lost device would take all of it. `scheduleFlush` remembers when
the first unsent change was queued and arms the timer for whichever comes first — 3 s of quiet
or 8 s since that first change. The clock restarts when a flush starts, from the timer or from
anything else that calls `flush()` (hiding the tab, coming back online, closing). Continuous
typing therefore costs at most one append every 8 s, which is what keeps the cap from becoming a
storage cost of its own. Batches are chunked to stay under the server's 262144-character
per-delta ceiling, and **a single local update over it is split** (`splitUpdate`, below) rather than
refused.

`client_update_id` is generated once per batch and **reused on retry**, so a replay after a
dropped response is skipped server-side and consumes no sequence number.

Because of the debounce, `status: "saving"` means two different things: changes queued and
waiting for the timer, and changes being pushed. `SyncState.uploading` tells them apart — `true`
from the moment `flush()` starts a drain until that drain settles, `false` otherwise — and
`pending` counts what the server does not have yet, in flight included. The editor's save dot
reads both ([`lib/app`](../app/documents.ts)'s `saveIndicator`).

## Following other devices: one request per open document

An open document learns about other devices' edits by **polling its own updates route**,
`GET /documents/{id}/updates?since=<cursor>` ([Task 148](../../../../tasks-closed.md#task-148)).
The response carries the document's head beside the deltas — `revision` and `snapshot_seq`, read
in the same transaction — so one call answers every case:

| What the poll sees                     | What `DocumentSync` does                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| no deltas, the same `revision`         | nothing — the common case                                                       |
| deltas, the same `revision`            | checks they follow the cursor, applies them                                     |
| another `revision`                     | another device compacted: `refreshHead` reads the snapshot and pulls from zero  |
| `revision` changes between two pages   | `listUpdatesSince` throws `RevisionChangedError`; the same refresh              |
| `404`                                  | the document was deleted or trashed elsewhere: status `gone`, polling stops     |

Until 2026-10-08 the poll read `GET /documents` — the whole index, every page — to find one row,
and ran in every tab whether visible or not. The transport no longer has `listMeta`.

The revision is checked **before** contiguity. After a compaction elsewhere the log may continue
above the cursor or restart at `1`, and either would look like a gap if it were read as a
continuation of the old log. A cold pull whose revision differs from the snapshot it just applied
(a compaction landed between the two reads) refreshes too. Refreshing is bounded:
`MAX_HEAD_REFRESHES` (3) in a row, then an error rather than a loop.

**The interval backs off while nothing changes**: 20 s, then 40 s, then 60 s
(`DEFAULT_MAX_POLL_INTERVAL_MS`, the `maxPollIntervalMs` option), and back to 20 s on the first
change. `startPolling` restarts at the base interval. **Polling stops while the tab is hidden**:
`components/documents/useDocumentSync` calls `stopPolling` on hiding the tab and, on showing it,
polls at once and starts again — so an idle open document costs one small request per interval
while it is looked at, and none while it is not.

A `gone` document keeps what was typed locally but sends nothing more: `flush` returns at once and
the editor's label says the document was deleted on another device.

## A refused write waits, it is not offline

The server limits appends to 120 a minute and compactions to 30 an hour per account
([Task 149](../../../../tasks-closed.md#task-149)), far above what an editor sends. When a push
is refused with `429`, `DocumentSync` keeps the batch in flight and the queue intact, sets status
`waiting` and arms a timer for `Retry-After` (10 s when the header is missing). Until it fires,
`flush` does nothing — a new edit still queues, and the status stays `waiting` — and then the
engine sends the queue on its own. `markOffline` is for network failures only; a `429` used to
go through it, which showed "Offline" and retried only on the next edit.

A refused compaction blocks further compactions until its `Retry-After` has passed. The document
keeps working from its log in the meantime.

## Document titles live inside the CRDT

The API stores no title — it is zero-knowledge, and the index returns metadata only. The title is
therefore a field in the document itself: `doc.getMap('meta').get('title')`, alongside the body in
`doc.getXmlFragment('body')`.

The consequence is that the dashboard list cannot be rendered from `GET /documents` alone.
`loadDocumentSummaries` opens each document (snapshot plus log) at a bounded concurrency of 4 and
reads the title out, the same shape `listNotes` uses. An undecryptable document degrades to a
tile marked unreadable rather than failing the whole list.

## The base font lives inside the CRDT too

`meta.font` is the font the document's text is drawn in when no font is set on it. It is a
value from [`lib/document-styles`](../document-styles/README.md)' `FONT_FAMILIES`, and it is read
through `documentBaseFont`, which sanitises it and falls back to Inter.

The field exists so a **new** document can start in Arial while every document written before it
keeps the Inter it was written in. A document gets it once, the first time it is opened while
`isUntouched` — no device has ever written anything to it, so `doc.store.clients` is empty.
`components/documents/useDocumentSync` writes it right after `open()`, and it syncs like any other
edit. A document created before this field and never opened gets it too; it has no text, so
nothing changes appearance. A document with any content, a restored one or a shared copy, is
never untouched and keeps what it had.

Deciding at first open rather than at `createDocument` keeps creation a single request: writing
the field there would mean creating from a snapshot, which is a create plus a compaction.

## The page margins live inside the CRDT too

`meta.margins` is `{ top, right, bottom, left }` in millimetres — the document's page margins,
read through [`lib/document-page`](../document-page/README.md)'s `pageMargins`, which falls back to
the 2.54 cm every document had before the field existed. It is seeded on the same terms and in the
same transaction as `meta.font`: an untouched document gets 3 cm top and left, 2 cm right and
bottom. `writePageMargins` stores exactly the four sides, whatever else the object carries.

## The outline is derived, and stays that way

`outline.ts` turns a ProseMirror document into a heading tree for the navigation panel. It is a
pure function of the document and is **never written back**, which is a storage decision as much as
a design one.

The obvious alternative is what most editors do: give each heading a stable `id` attribute and
address it by that. An attribute is part of the CRDT, so minting ids appends sealed deltas — and an
id minted during render appends them on _every_ device that opens the document, forever, for a
value that can be recomputed in microseconds. Everything in [§ Debounce is a storage
decision](#debounce-is-a-storage-decision) applies with none of the compensating benefit.

ProseMirror positions are enough. A position addresses a node exactly, and it is valid for the
state it was read from — so the rule is to re-read the outline on every change and **never cache a
position across transactions**. TipTap's own Table of Contents extension is built on the stamped-id
model and is in the paid Pro tier; both facts are reasons not to reach for it.

`headingAtScroll` takes measured heading offsets rather than elements, and `outlineTree` takes
entries rather than a document, so both are testable in the node-environment suite. The DOM half — the
scroll, the focus — lives in `components/documents/useOutline.ts`.

## Pagination is measured, never written

`pagination.ts` takes the measured height of each top-level block and returns the index of the
first block on each page plus the blank space left above it. It is the same bargain as the outline:
**a layout concern that must not reach the CRDT.**

Automatic pagination is normally done by splitting or reflowing nodes so they fit the page. Here
that would be a sealed delta appended on every device, on every reflow, for something no reader
asked to persist — and it would fight every other device doing the same. So the break is expressed
as a ProseMirror **decoration**, which lives in the view and never becomes a document step. The
plugin's only transaction carries `setMeta` and no steps, so Yjs emits no update and the log does
not grow.

`paginate` is greedy: fill the page, and when the next block does not fit, start a new page with
it. A block is never split, which is why `break-inside: avoid` on every top-level block is the
matching print rule — the browser then reaches the same answer this function did.

**A heading is `keepWithNext`.** When a break would land immediately after one, the heading is
carried to the next page with the content it introduces, so a section title never dangles alone at
the foot of a page. The pull-back stops if carrying the heading would not actually fit, and it
never empties a page to rescue a heading that opens it — both cases are tested.

The one thing that legitimately _is_ content is an explicit page break: the user asked for it, so
`pageBreak` is a real node in the document. `breaksAfter` ends the page wherever it sits.

`paginate` builds a prefix-sum array first, so asking how much of a page a run of blocks fills is
O(1) and the whole pass is O(n) — a long document is paginated in one linear sweep, and there is a
20 000-block case in the tests to keep it that way.

`samePagination` exists because comparing only the blank-space values is not enough to decide
whether the layout changed. Split a paragraph that starts a page and the break moves to a
different block while the space left above it barely moves — compare the fills alone and the
plugin concludes nothing happened, skips the rebuild, and leaves the page geometry stale for good.
It compares the block index as well, and only tolerates sub-pixel drift in the fill.

## Images are attachments, and compaction reports them

The image bytes are not in the CRDT: an image is an attachment of the document, its key in the
document's `attachments` map ([`attachments/`](attachments/README.md)). Two things here know about
it. After a compaction installs, `DocumentSync` reports the attachments the snapshot still
references through the transport's optional `reportAttachments` (`apiTransport` sends
`PUT /documents/{id}/attachments/references`), so the server can collect an image removed from the
text 30 days later; a document that never had an attachment sends nothing, and a failed report
never fails the compaction. And `readFirstPage` (`miniature.ts`) keeps the beginning of the body —
up to the first page break, 60 blocks or 4000 characters, links dropped — with the margins, the
font and the thumbnails of the images on it, which is what a tile on the Documents screen draws.

## Deletes

The two delete routes are the only ones that need a signed action; create, edit and compact are
JWT-only, because an autosave cannot prompt for a seed signature every two seconds.

`document-delete` is **variadic**, so `normalizeActionArgs` sorts and de-duplicates the ids before
signing — the server rebuilds the argument list the same way, and an unsorted list produces a
signature that cannot verify.

## Splitting an update

One Yjs transaction can produce an update far larger than one delta: a paste of 10 000 cells, an
undo of one, 60 000 row ids inserted at once — which Yjs merges into a **single struct**. Yjs has no
public way to split an update, so `split.ts` re-encodes it in the V1 format, which is stable:

- `Y.decodeUpdate` gives the structs and the delete set.
- A countable struct larger than the budget is written in pieces: each piece is a copy of the
  item with its content truncated, written at an offset, which is exactly how Yjs writes the right
  half of an item it split itself. A text piece never ends on half of a surrogate pair.
- Pieces are packed into chunks under the budget, each a valid update with its own client groups;
  the delete set goes last, spread over as many chunks as it needs.

Chunks apply in any order — Yjs holds a struct whose origin has not arrived yet as pending — and
re-applying one is harmless, so a dropped response and a retry change nothing. **One struct that
cannot be split** — a single value larger than a delta, such as a 300 KB string set as one map
value — throws `UnsplittableUpdateError`; the spreadsheet binding refuses such a cell before it is
written.
