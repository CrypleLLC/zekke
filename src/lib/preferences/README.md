# `lib/preferences` — the account's sealed preferences

One sealed blob per account, `{ version, regional }`, through `GET` and `PUT /preferences`
([front-end-endpoints § 26](../../../front-end-endpoints.md#26-preferences-endpoints)). Why it is
one blob, under the `documents` keyring, is
[ADR 00021](../../../../api-general/docs/adr/00021_account_preferences.md). What `regional` holds is
[`lib/regional`](../regional/README.md).

| Export | What it does |
| --- | --- |
| `loadPreferences(context, fallbackCountry)` | Reads and opens the blob once per session; nothing stored is the browser country's defaults, `stored: false`, without a write |
| `savePreferences(context, fallbackCountry, edit)` | Applies `edit` and writes, sealed under a fresh DEK wrapped by the current `documents` KEK |
| `resealPreferences(context, fallbackCountry)` | After a rotation, re-seals a blob an older generation wraps; `lib/rekey` calls it with `documents` |
| `cachedPreferences`, `subscribePreferences` | What this session has, and a listener for every change |

- **Sealed like a folder manifest**: a fresh DEK per write, wrapped under `documents`' current
  generation, the JSON sealed under it. The server sees neither the country nor any format.
- **Signed** `preferences-update` over the revision it replaces and the hex SHA-256 of the
  ciphertext.
- **Concurrent edits merge by setting**: `edit` is a function, re-applied to a fresh read after a
  `409 CONFLICT`, so two devices changing different settings keep both. `STALE_KEY_GENERATION`
  refreshes the keyrings and seals again.
- **Forgotten when the session locks**, like everything else held in memory.
- **Unreadable is defaults**: a blob that does not parse, or a field that does not, reads as the
  country's default rather than failing the page.

`preferences.test.ts` runs all of it against a fake server: nothing stored, another device opening
a write, the signature, a merge after a conflict, listeners, and a re-seal after a rotation.
