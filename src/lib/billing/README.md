# `billing`

The web app's client of the **billing service** — a separate origin
([billing/README.md](../../../../billing/README.md)), at `NEXT_PUBLIC_BILLING_URL` (default
`http://localhost:8070`), whose origin the CSP's `connect-src` names.

| Export | |
| ------ | - |
| `Tickets` | Asks the API for a ticket (`POST /billing/ticket`) and reuses it until a minute before it expires. The ticket names a random billing reference; the API JWT never leaves for billing |
| `listPrices()` | `GET /prices`, no ticket |
| `startCheckout(tickets, priceId, provider)` | `POST /checkout`: a Stripe `url` to navigate to, or a Strike `quote` |
| `checkoutState(tickets, id)` | `GET /checkout/{id}`: `open`, `completed` or `expired`. Billing asks Strike before answering, so polling this settles a Bitcoin payment |
| `requote(tickets, id)` | A fresh quote once the last one expired |
| `portalUrl(tickets)` | The Stripe Customer Portal, for cards, plan changes and cancelling |
| `lightningUri`, `invoiceQr` | `lightning:<invoice>`, and its QR code drawn locally — uppercase, error correction L, because an invoice is long |
| `BillingError` | A refusal, with billing's `code` (`SUBSCRIPTION_RENEWS`, `NO_CUSTOMER`, `PROVIDER_DISABLED`, …) or `BILLING_UNAVAILABLE` when there was none to read |

**Nothing here decides what the account has.** After paying, the client reads `GET /users/me` until
`plan` changes; the return from Stripe and the end of a Bitcoin checkout are only cues to look.
