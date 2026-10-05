# `qr`

QR codes drawn locally, never fetched: `qrModules(payload, ecc, border)` is `uqr`'s matrix, and
`qrModulePath(modules)` turns it into one SVG path, one rectangle per horizontal run. Shared by the
recovery kit ([`lib/recovery-kit`](../recovery-kit/README.md)) and the Bitcoin checkout
([`lib/billing`](../billing/README.md)). It holds no secret and imports nothing of the app, so the
browser extension may bundle it even though it must never bundle the recovery kit.
