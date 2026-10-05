import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCES = [
  'univer.ts',
  'SpreadsheetEditor.tsx',
  'binding.ts',
  'surface.ts',
  'capture.ts',
  'apply.ts',
  'capacity.ts',
  'memory-storage.ts',
  'private-text.ts',
  'remote-functions.ts',
];

const PATTERNS: Record<string, RegExp> = {
  fetch: /\bfetch\s*\(/g,
  xhr: /XMLHttpRequest/g,
  websocket: /\bWebSocket\b/g,
  beacon: /sendBeacon/g,
  eventSource: /\bEventSource\b/g,
  worker: /new\s+(Shared)?Worker\s*\(/g,
  importScripts: /importScripts/g,
  localStorage: /\blocalStorage\b/g,
  sessionStorage: /\bsessionStorage\b/g,
  indexedDB: /\bindexedDB\b/g,
  clipboard: /navigator\.clipboard/g,
  eval: /(^|[^.\w])eval\s*\(/g,
  newFunction: /new\s+Function\s*\(/g,
  cookie: /document\.cookie/g,
  serviceWorker: /serviceWorker/g,
  wasm: /WebAssembly/g,
};

const REVIEWED: Record<string, Record<string, number>> = {
  '@univerjs/drawing': { fetch: 2 },
  '@univerjs/rpc': { worker: 1 },
  '@univerjs/sheets-formula-ui': { localStorage: 2 },
  '@univerjs/ui': { localStorage: 8, indexedDB: 2, clipboard: 8 },
};

const ROOT = join(__dirname, '..', '..', '..');
const source = SOURCES.map((file) => readFileSync(join(__dirname, file), 'utf8')).join('\n');

function loadedPackages(): string[] {
  const queue = [...new Set([...source.matchAll(/from '(@univerjs\/[a-z-]+)/g)].map((match) => match[1]))];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const manifest = JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    queue.push(...Object.keys(manifest.dependencies ?? {}).filter((dependency) => dependency.startsWith('@univerjs/')));
  }
  return [...seen].sort();
}

function inventory(name: string): Record<string, number> {
  const file = join(ROOT, 'node_modules', name, 'lib', 'es', 'index.js');
  if (!existsSync(file)) {
    return {};
  }
  const code = readFileSync(file, 'utf8');
  return Object.fromEntries(
    Object.entries(PATTERNS)
      .map(([key, pattern]) => [key, code.match(pattern)?.length ?? 0] as const)
      .filter(([, count]) => count > 0),
  );
}

describe('what Univer could do with the network or the disk', () => {
  it('has not changed since it was reviewed', () => {
    const found = Object.fromEntries(
      loadedPackages()
        .map((name) => [name, inventory(name)] as const)
        .filter(([, counts]) => Object.keys(counts).length > 0),
    );
    expect(found).toEqual(REVIEWED);
  });

  it('loads none of the plugins that make the reviewed calls reachable', () => {
    for (const forbidden of [
      'UniverNetworkPlugin',
      'UniverRPCMainThreadPlugin',
      'UniverDrawingPlugin',
      'UniverSheetsFormulaMobileUIPlugin',
      'UniverMobileUIPlugin',
      'ITelemetryService',
      '@univerjs/network',
      '@univerjs/rpc',
      '@univerjs/drawing',
      '@univerjs/telemetry',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('gives Univer a storage service that only lives in memory', () => {
    expect(source).toContain('[ILocalStorageService, { useClass: MemoryLocalStorageService }]');
  });
});
