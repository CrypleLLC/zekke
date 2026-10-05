import { sha256 } from '@noble/hashes/sha2.js';
import * as Y from 'yjs';
import { stylesMap } from './layout';

const STYLE_ID_BYTES = 9;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export type StyleData = Record<string, unknown>;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined && item !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export function styleId(style: StyleData): string {
  const digest = sha256(new TextEncoder().encode(canonicalJson(style)));
  let id = '';
  for (let index = 0; index < STYLE_ID_BYTES; index += 3) {
    const chunk = (digest[index] << 16) | (digest[index + 1] << 8) | digest[index + 2];
    id += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63] + ALPHABET[(chunk >> 6) & 63] + ALPHABET[chunk & 63];
  }
  return id;
}

export function isEmptyStyle(style: StyleData): boolean {
  return canonicalJson(style) === '{}';
}

export function internStyle(doc: Y.Doc, style: StyleData): string | undefined {
  if (isEmptyStyle(style)) {
    return undefined;
  }
  const id = styleId(style);
  const styles = stylesMap(doc);
  if (!styles.has(id)) {
    styles.set(id, JSON.parse(canonicalJson(style)) as StyleData);
  }
  return id;
}

export function readStyle(doc: Y.Doc, id: string): StyleData | undefined {
  const stored = stylesMap(doc).get(id);
  return typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as StyleData) : undefined;
}
