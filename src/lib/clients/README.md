# `clients`

The client side of the version policy ([front-end-endpoints.md § 25](../../../front-end-endpoints.md#25-client-version-endpoints)),
for the apps that are not the web app: the browser extension today, the mobile apps when they ship.

| Export | |
| ------ | - |
| `getClientPolicy(platform)` | `GET /clients/{platform}/policy`; `undefined` when it cannot be read, because the check fails open |
| `versionNotice(policy, version)` | `required` below `min_supported`, `deprecated` (with `deprecationEnds`) below `deprecated_below`, `available` below `latest`, otherwise `current` |
| `compareVersions(a, b)` | Semantic versions, a pre-release before its release; `undefined` when either does not parse |

**Identifying the client is `lib/api`'s `identifyClient(platform, version)`**: once called, every
request carries `Zekke-Client: <platform>/<version>`, and a version below the minimum gets
`ApiError.isUpgradeRequired` (`426`). The web app never calls it — it is always the deployed build,
and a custom header would cost a CORS preflight on every request. A stale tab is
`components/shell/NewVersionNotice`'s job instead.
