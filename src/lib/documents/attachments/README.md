# `lib/documents/attachments` — images in a document

An image in a document is an **attachment of that document**: an encrypted object in the drive's
object storage, owned by the document and not by the drive
([ADR 00020](../../../../../api-general/docs/adr/00020_document_attachments.md)). This module is the
client half, framework-free and tested in the node suite: the key, the sealing, the routes, the
preparation of an image for the page, the upload, and opening one into a `blob:` URL. The wire
contract is [front-end-endpoints.md § 16 Attachments](../../../../front-end-endpoints.md#attachments--the-images-in-a-document).
The editor that uses it is [`components/documents`](../../../components/documents/README.md#images).

## Files

| File           | Role                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- |
| `records.ts`   | Wire types and the numbers: 5 MB in, 2 × the text width out, 200 per copy               |
| `map.ts`       | The attachment map in the `Y.Doc`, the image nodes in the body, references, remapping   |
| `crypto.ts`    | One chunk of the drive's envelope under a key of its own, padded to the drive's bucket |
| `api.ts`       | The attachment routes, the usage route, and the two share routes                        |
| `prepare.ts`   | Refusing, decoding, scaling and re-encoding an image, and deriving its thumbnail        |
| `upload.ts`    | Planning an attachment (its key and size, before anything is sent) and uploading it    |
| `images.ts`    | `AttachmentImages`: download, check, open, one `blob:` URL per image per open document |
| `placement.ts` | The image node's attributes — share of the text width, alignment, alt text — and resizing |

## Where the key lives

Each attachment has its own random 256-bit key, and **the key lives in the document**, in the
top-level `Y.Map` named `attachments`: id → `{key, size, stored, mime, width, height, thumbnail?}`.
`size` is the true length of the image, which the padded object hides; `stored` is the sealed size
the quota is charged. Whoever can open the document can open its images, under the `documents`
scope, and a rotation of that keyring re-wraps the document's DEK and leaves these keys alone:
they are content.

- **Not in the image node.** The node carries only the attachment's id, so the HTML every copy puts
  on the system clipboard carries no key.
- **A top-level map, not one nested in `meta`.** Two devices creating a nested `Y.Map` under the
  same key concurrently would each make their own, and one would win: every image the other added
  would lose its key. `doc.getMap('attachments')` is the same shared type on every device.
- **Entries are never pruned.** An image removed from the text keeps its entry, so undo, and
  another device's offline edits that still show it, find the key. The object is what goes, 30 days
  after the server last heard it referenced.

## The object

```
object = sealChunk(pad(image bytes), index 0, count 1, key)      lib/files/chunks
```

The drive's chunk envelope and padding (`lib/files`), reused rather than forked. An attachment is
**always one chunk**: 8 MiB of payload is more than a prepared image reaches, so it is one `PUT`
and never a multipart, and `storedAttachmentBytes` refuses anything larger. The chunk IV is the
chunk's index, which is safe only because **a key seals exactly one object**: an image pasted into
another document is sealed again under a new key, and a copy for a recipient is the same
ciphertext under the same key, never new content under an old one.

`openAttachment` checks the server's `ciphertext_sha256` against the bytes that arrived before
decrypting, then cuts the padding off at `size`.

## Preparing an image

`prepareImage` runs in the browser (`createImageBitmap`, `OffscreenCanvas`, a `<canvas>` where
there is none); the decisions are pure functions with tests.

- **Refused before any work**: SVG (a document that can carry script), anything that is not JPEG,
  PNG, WebP, GIF, AVIF or BMP, and anything over **5 MB** as given (`MAX_SOURCE_IMAGE_BYTES`,
  5 MiB).
- **Scaled down, never up**, to at most `PREPARED_MAX_WIDTH_PX` — twice the continuous view's text
  width (62.4 rem ≈ 998 px), the largest an image is ever shown, sharp on a high-density screen —
  and 8000 px tall.
- **Re-encoded at quality 0.9**: WebP, or JPEG where the browser cannot encode WebP. A source that
  can be transparent is checked pixel by pixel; when it is, JPEG is out, and PNG is kept only when
  it is smaller than WebP (`chooseEncoding`). Re-encoding drops EXIF — position, camera, date — and
  an animated GIF keeps its first frame.
- **A thumbnail in the same pass**, at most 480 px wide at quality 0.75 — about 20 KB, one 64 KiB
  bucket — uploaded as **an attachment of its own**. Which attachment is whose thumbnail is the
  `thumbnail` field in the map, never a column the server could read.

## Uploading

`planImage` decides both attachments' ids and keys **before anything is sent**, so the editor can
write the entries into the document at once. Another device then always knows an image in flight
is this document's — its download answers `404` and it says "still uploading" — and never mistakes
it for an image pasted from elsewhere.

`uploadAttachment` reserves the sealed size (`POST`, `507 QUOTA_EXCEEDED` when files and
attachments together would not fit), `PUT`s the object to the presigned URL, and completes with its
SHA-256. A failed `PUT` or completion gives the reservation back (`DELETE …/upload`, where `404`
means already gone). **A retry uses the same id and key**: sealing is deterministic for a given key
and image, so a retry of an upload that had in fact landed finds the row stored with the same hash
and is done; a stored row with a different hash is an error, never overwritten.

## Opening

`AttachmentImages` is one per open document. `open(id)` downloads, checks, decrypts and hands out
**one `blob:` URL per image**, cached for as long as the document is open and revoked by `close()`.
A failure is not cached, so the next `open` tries again. `adopt` gives an image this device just
uploaded its URL without a round trip. The errors say what happened:

- `AttachmentKeyMissingError` — the node names an attachment this document has no key for: it was
  pasted from another document.
- `AttachmentUnavailableError` — the server answered `404`: still uploading from another device,
  abandoned, or removed.

**Every image this tab has opened is remembered, decrypted, for re-upload** (`rememberImage`,
`recallImage`, the last 32), so pasting an image copied from another open document can upload it
again into the target under a new key. The memory is in this tab only, and the session's lock
clears it (`forgetRememberedImages`, from `ZekkeProvider`).

## References

The server cannot see which images a document still shows. At each compaction `DocumentSync`
reports the ids its snapshot references — every image node's attachment and that image's
thumbnail (`referencedAttachmentIds`) — through `PUT …/references`; the server marks the others
unreferenced and deletes them 30 days later. It reports only for a document that has ever had an
attachment, skips a list over 10 000, and never lets a failed report fail the compaction.

## Copying a shared document

A recipient's copy is a new document, and an attachment id is unique per account, so
`remapAttachments` gives every referenced attachment a new id — in the map and in the image nodes —
and returns the pairs and the bytes they will cost. `copySharedItem`
([`lib/sharing`](../../sharing/README.md#copying-a-shared-item--copyshareditem)) checks the
recipient's usage first, creates the document, asks the server to copy the objects
(`POST /shares/{id}/attachments/copy`, 200 pairs per request), and deletes the document again if
the copy is refused. The keys do not change: the copied objects are the same ciphertext.
