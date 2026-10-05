const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export const ROW_ID_LENGTH = 8;
export const COLUMN_ID_LENGTH = 4;
export const SHEET_ID_LENGTH = 10;
export const ELEMENT_ID_LENGTH = 10;

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function randomId(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) {
    id += ALPHABET[byte & 63];
  }
  return id;
}

export function freshIds(count: number, length: number, taken: ReadonlySet<string>): string[] {
  const ids: string[] = [];
  const issued = new Set<string>();
  while (ids.length < count) {
    const id = randomId(length);
    if (taken.has(id) || issued.has(id)) {
      continue;
    }
    issued.add(id);
    ids.push(id);
  }
  return ids;
}

export function isId(value: unknown, length: number): value is string {
  return typeof value === 'string' && value.length === length && ID_PATTERN.test(value);
}
