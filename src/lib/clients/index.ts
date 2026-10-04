import { isSemanticVersion, request, type ClientPlatform } from '@/lib/api';

export interface ClientPolicy {
  platform: ClientPlatform;
  min_supported: string;
  latest: string;
  deprecated_below?: string;
  deprecation_ends?: string;
}

export type VersionNotice =
  | { level: 'current' }
  | { level: 'available'; latest: string }
  | { level: 'deprecated'; latest: string; deprecationEnds: string }
  | { level: 'required'; latest: string };

interface Parsed {
  core: [number, number, number];
  prerelease: string[];
}

function parse(version: string): Parsed | undefined {
  if (!isSemanticVersion(version)) {
    return undefined;
  }
  const [core, prerelease] = version.split(/-(.*)/s);
  const [major, minor, patch] = core.split('.').map(Number);
  return { core: [major, minor, patch], prerelease: prerelease === undefined ? [] : prerelease.split('.') };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return a.length === b.length ? 0 : a.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) {
      continue;
    }
    const left = /^\d+$/.test(a[i]) ? Number(a[i]) : undefined;
    const right = /^\d+$/.test(b[i]) ? Number(b[i]) : undefined;
    if (left !== undefined && right !== undefined) {
      return Math.sign(left - right);
    }
    if (left !== undefined) {
      return -1;
    }
    if (right !== undefined) {
      return 1;
    }
    return a[i] < b[i] ? -1 : 1;
  }
  return Math.sign(a.length - b.length);
}

export function compareVersions(a: string, b: string): number | undefined {
  const left = parse(a);
  const right = parse(b);
  if (left === undefined || right === undefined) {
    return undefined;
  }
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) {
      return Math.sign(left.core[i] - right.core[i]);
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function below(version: string, floor: string | undefined): boolean {
  if (floor === undefined) {
    return false;
  }
  const order = compareVersions(version, floor);
  return order !== undefined && order < 0;
}

export function versionNotice(policy: ClientPolicy, version: string): VersionNotice {
  if (below(version, policy.min_supported)) {
    return { level: 'required', latest: policy.latest };
  }
  if (policy.deprecation_ends !== undefined && below(version, policy.deprecated_below)) {
    return { level: 'deprecated', latest: policy.latest, deprecationEnds: policy.deprecation_ends };
  }
  if (below(version, policy.latest)) {
    return { level: 'available', latest: policy.latest };
  }
  return { level: 'current' };
}

export async function getClientPolicy(
  platform: ClientPlatform,
  options: { timeoutMs?: number } = {},
): Promise<ClientPolicy | undefined> {
  try {
    const response = await request<ClientPolicy>({
      method: 'GET',
      path: `/clients/${platform}/policy`,
      timeoutMs: options.timeoutMs,
    });
    return response.data;
  } catch {
    return undefined;
  }
}
