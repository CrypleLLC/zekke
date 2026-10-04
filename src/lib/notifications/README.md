# `notifications`

The client of `GET /notifications` and `POST /notifications/read`
([front-end-endpoints.md § 24](../../../front-end-endpoints.md#24-notifications-endpoints)). The
server sends a `kind` and `params`, never text; the sentences are written in
[`lib/app/notifications.ts`](../app/notifications.ts), and the bell that shows them is
[`components/shell/NotificationBell.tsx`](../../components/shell/README.md).

| Export | |
| ------ | - |
| `listNotifications(context, { limit?, cursor? })` | One page, newest first: `{ notifications, unreadCount, nextCursor? }`. `params` that is not an object becomes `{}` |
| `unreadNotificationCount(context)` | The account's unread count, read with `limit=1` |
| `markNotificationsRead(context, ids)` | De-duplicates, refuses a non-canonical id rather than rewriting it, and sends at most 200 per request |
| `markAllNotificationsRead(context)` | `{ all: true }` |
| `NOTIFICATION_KINDS`, `isKnownKind` | The kinds this version can word. **A kind outside the list is shown as a generic notice**, never dropped and never an error, so an older client survives a newer server |

Nothing here is secret or sealed: a notification is about the account, never about what it stores,
so it needs only the session's token (`TokenContext`), not the keystore.
