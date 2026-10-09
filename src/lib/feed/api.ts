import { request } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';
import { Feed, type FeedOptions } from './feed';
import type { ChangesPage, FeedScope } from './records';

export async function fetchChanges(
  context: AuthedContext,
  scope: FeedScope,
  since: number,
  limit: number,
): Promise<ChangesPage> {
  const response = await request<ChangesPage>({
    method: 'GET',
    path: '/changes',
    query: { scope, since, limit },
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return {
    changes: response.data?.changes ?? [],
    cursor: response.data?.cursor ?? since,
    more: response.data?.more === true,
  };
}

const feeds = new WeakMap<AuthedContext, Feed>();

export function feedFor(context: AuthedContext, options?: FeedOptions): Feed {
  let feed = feeds.get(context);
  if (feed === undefined) {
    feed = new Feed((scope, since, limit) => fetchChanges(context, scope, since, limit), options);
    feeds.set(context, feed);
  }
  return feed;
}
