import * as Y from 'yjs';

export class UnsplittableUpdateError extends Error {
  constructor(readonly bytes: number) {
    super(`a single Yjs struct encodes to ${bytes} bytes and cannot be split below the delta ceiling`);
    this.name = 'UnsplittableUpdateError';
  }
}

type Struct = Y.Item | Y.GC | Y.Skip;

interface Piece {
  client: number;
  clock: number;
  length: number;
  bytes: number;
  write: (encoder: Y.UpdateEncoderV1) => void;
}

interface DeleteRange {
  client: number;
  clock: number;
  len: number;
}

const ENVELOPE_BYTES = 64;
const DELETE_RANGE_BYTES = 12;

function measure(write: (encoder: Y.UpdateEncoderV1) => void): number {
  const encoder = new Y.UpdateEncoderV1();
  write(encoder);
  return encoder.toUint8Array().length;
}

function itemPiece(item: Y.Item, from: number, to: number): Piece {
  const write = (encoder: Y.UpdateEncoderV1) => {
    const content = item.content.copy();
    if (to < item.length) {
      content.splice(to);
    }
    const clone = new Y.Item(item.id, null, item.origin, null, item.rightOrigin, item.parent, item.parentSub, content);
    clone.write(encoder, from);
  };
  return { client: item.id.client, clock: item.id.clock + from, length: to - from, bytes: measure(write), write };
}

function boundary(item: Y.Item, from: number, to: number): number {
  if (to >= item.length || to - from < 2 || !(item.content instanceof Y.ContentString)) {
    return to;
  }
  const code = item.content.str.charCodeAt(to - 1);
  return code >= 0xd800 && code <= 0xdbff ? to - 1 : to;
}

function structPieces(struct: Struct, budget: number): Piece[] {
  if (!(struct instanceof Y.Item) || !struct.content.isCountable() || struct.length <= 1) {
    const write = (encoder: Y.UpdateEncoderV1) => struct.write(encoder, 0);
    return [{ client: struct.id.client, clock: struct.id.clock, length: struct.length, bytes: measure(write), write }];
  }
  const whole = itemPiece(struct, 0, struct.length);
  if (whole.bytes <= budget) {
    return [whole];
  }
  const pieces: Piece[] = [];
  let from = 0;
  let span = Math.max(1, Math.floor((struct.length * budget) / whole.bytes / 2));
  while (from < struct.length) {
    const to = boundary(struct, from, Math.min(struct.length, from + span));
    const piece = itemPiece(struct, from, to);
    if (piece.bytes > budget && to - from > 1) {
      span = Math.max(1, Math.floor(span / 2));
      continue;
    }
    pieces.push(piece);
    from = to;
  }
  return pieces;
}

function encodeChunk(pieces: readonly Piece[], deletes: readonly DeleteRange[]): Uint8Array {
  const encoder = new Y.UpdateEncoderV1();
  const groups: Piece[][] = [];
  for (const piece of pieces) {
    const last = groups[groups.length - 1];
    const previous = last?.[last.length - 1];
    if (previous !== undefined && previous.client === piece.client && previous.clock + previous.length === piece.clock) {
      last.push(piece);
    } else {
      groups.push([piece]);
    }
  }
  encoder.writeLen(groups.length);
  for (const group of groups) {
    encoder.writeLen(group.length);
    encoder.writeClient(group[0].client);
    encoder.writeLen(group[0].clock);
    for (const piece of group) {
      piece.write(encoder);
    }
  }

  const byClient = new Map<number, DeleteRange[]>();
  for (const range of deletes) {
    const list = byClient.get(range.client) ?? [];
    list.push(range);
    byClient.set(range.client, list);
  }
  encoder.writeLen(byClient.size);
  for (const [client, ranges] of [...byClient.entries()].sort((a, b) => b[0] - a[0])) {
    encoder.resetDsCurVal();
    encoder.writeLen(client);
    encoder.writeLen(ranges.length);
    for (const range of ranges.sort((a, b) => a.clock - b.clock)) {
      encoder.writeDsClock(range.clock);
      encoder.writeDsLen(range.len);
    }
  }
  return encoder.toUint8Array();
}

export function splitUpdate(update: Uint8Array, maxBytes: number): Uint8Array[] {
  if (update.length <= maxBytes) {
    return [update];
  }
  const budget = maxBytes - ENVELOPE_BYTES;
  const { structs, ds } = Y.decodeUpdate(update);

  const pieces: Piece[] = [];
  for (const struct of structs as Struct[]) {
    if (struct instanceof Y.Skip) {
      continue;
    }
    for (const piece of structPieces(struct, budget)) {
      if (piece.bytes > budget) {
        throw new UnsplittableUpdateError(piece.bytes);
      }
      pieces.push(piece);
    }
  }

  const deletes: DeleteRange[] = [];
  ds.clients.forEach((items, client) => {
    for (const item of items) {
      deletes.push({ client, clock: item.clock, len: item.len });
    }
  });

  const chunks: Uint8Array[] = [];
  let current: Piece[] = [];
  let currentBytes = 0;
  for (const piece of pieces) {
    if (current.length > 0 && currentBytes + piece.bytes > budget) {
      chunks.push(encodeChunk(current, []));
      current = [];
      currentBytes = 0;
    }
    current.push(piece);
    currentBytes += piece.bytes;
  }

  let pendingDeletes: DeleteRange[] = [];
  for (const range of deletes) {
    if (currentBytes + DELETE_RANGE_BYTES > budget) {
      chunks.push(encodeChunk(current, pendingDeletes));
      current = [];
      pendingDeletes = [];
      currentBytes = 0;
    }
    pendingDeletes.push(range);
    currentBytes += DELETE_RANGE_BYTES;
  }
  if (current.length > 0 || pendingDeletes.length > 0) {
    chunks.push(encodeChunk(current, pendingDeletes));
  }
  return chunks;
}
