# `plan`

Buying and keeping a plan. The decisions are [ADR 00017](../../../../api-general/docs/adr/00017_billing_is_a_separate_service.md)
(billing is its own service; a card identifies the payer, Bitcoin does not) and
[ADR 00018](../../../../api-general/docs/adr/00018_downgrade_grace.md) (fourteen days of grace, then the
newest uploads go). The logic and every sentence are in [`lib/app/plan.ts`](../../lib/app/plan.ts);
the calls are [`lib/billing`](../../lib/billing/README.md).

| File | |
| ---- | - |
| `PlanScreen.tsx` | The **Plan** tab in Settings: the plan and its state, storage against the quota, how long the Trash keeps things, the grace warning, the prices (card and Bitcoin per price, as billing offers them), and **ADR 00018's data loss stated before any purchase**. Buying is refused while a card subscription renews — the portal changes plans then |
| `BitcoinCheckout.tsx` | A Strike quote in place of the price list: QR code, sats, BTC and dollars, the quote's countdown, *Open in wallet*, the invoice and on-chain address to copy, and *Get a new quote* once it expires. Polls the checkout every four seconds until it completes |
| `ManageSubscriptionButton` | In `PlanScreen.tsx`: opens the Stripe portal. Also on the Account tab, when a deletion would leave a renewing subscription |
| `GraceNotice.tsx` | Above every screen during grace: days left and how much is over the quota, with *See plans* |
| `CheckoutReturnNotice.tsx` | Reads `?checkout=done`, `?checkout=cancelled` or `?portal=done` once, strips it from the address bar, and after a payment re-reads the account every three seconds until the plan changes — or says it may take a few minutes after two |

The card checkout and the portal are full-page navigations to Stripe; nothing of Stripe runs in this
origin, so the CSP needs no Stripe host.
