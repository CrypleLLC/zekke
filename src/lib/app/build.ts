export const BUILD_ID_PATH = '/build-id';

export const BUILD_COPY = {
  title: 'A new version of Zekke is ready.',
  body: 'Reload this tab when you are ready to use it.',
  reload: 'Reload',
} as const;

export function runningBuildId(): string | undefined {
  const id = process.env.NEXT_PUBLIC_BUILD_ID?.trim();
  return id === undefined || id === '' ? undefined : id;
}

export function deployedBuildId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('build_id' in body)) {
    return undefined;
  }
  const id = (body as { build_id: unknown }).build_id;
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : undefined;
}

export function isNewerDeployment(running: string | undefined, deployed: string | undefined): boolean {
  return running !== undefined && deployed !== undefined && running !== deployed;
}
