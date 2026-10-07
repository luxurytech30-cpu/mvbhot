# Access, purchases and account billing

## Shared catalog

`backend/src/information/tv-catalog.json` defines all title metadata once. Its 27 content records include VOD and broadcast-only titles. The 42 program records reference `contentId`; the 14 channels reference current/next program IDs. Eight libraries reference the same content, and three plans define extra channel/library memberships. Seventeen offers define server-owned prices and purchase durations.

`catalog-data.js` resolves display metadata for the TV API and Nova. `catalog-validation.js` rejects duplicate IDs, missing references, mismatched schedules and invalid prices on startup. The TV fetches this catalog before mounting its pages; `data/content.ts`, `channels.ts` and `programs.ts` expose those API records rather than duplicate lists.

## Access rules

- Universal channels: 11, 12, 13, 14, 15, 33 and 80. Universal VOD libraries: Essentials and Music. No extra charge for any account.
- Basic: universal access plus Drama channel 30 and Drama+.
- Family: Basic plus Cinema 18, Movies 39, Kids 70, Movies+ and Kids+.
- Premium: Family plus Life 37, History 43, Sports 55, Discovery+ and Sports+.
- Premiere+ remains optional for every plan. Selected titles can be rented individually for 48 hours. The match can be purchased for seven days without buying the sports channel.
- A channel purchase unlocks that channel and its CatchUp programs, without granting an entire VOD library. A purchased library/title unlocks the same canonical content in VOD and eligible CatchUp appearances. A match pass unlocks that content and the current matching live event; other channel programs stay locked.
- All channels/titles remain visible. `user.access` supplies locks and eligible purchase options. `POST /api/playback` independently enforces access and records first use of one-time purchases. Favorites never grant access. Recordings/progress require appropriate access.
- CatchUp is a dated demo schedule, not real broadcasting. Player controls simulate playback; there is no streaming provider or payment processor.

## Purchases and cancellation

The authenticated account is always selected by the session cookie. The browser supplies an offer ID, never an authoritative price, customer ID or entitlement. Purchase operations reject unknown offers, duplicate active purchases and purchases already covered by the account.

Monthly purchases charge for the remaining days of the current calendar month, including the purchase day, then renew at the full published price. Cancellation stops renewal at month end and retains access for the current billed period. Reactivating before expiry does not charge twice.

Unused one-time purchases can be cancelled in their original open billing month for a full credit and immediate loss of access. Once playback starts, the demo rejects refunds. Cancelled/expired orders remain visible as history. Plan cancellation does not silently cancel separately purchased extras; each has its own control.

## Calculated monthly bill

Each account has a current-month draft, including October 2026. It is generated from `billing.ledger.entries`, not an unrelated sample. Prices include the configured 18% demo tax. Monetary line items and totals round to two decimals.

Changing plans credits unused days of the previous plan and charges remaining days of the new plan. The current draft shows both adjustments. Independently purchased extras remain; the UI lists them so users can cancel unwanted renewals.

The invoice groups recurring charges, one-time purchases and credits. Refunds are explicit negative line items. Old invoices are preserved. Calendar rollover issues the old draft and creates the next month from active subscriptions, without repeating expired one-time charges; skipped months are generated in sequence. Calendar calculations use UTC for this local demo.

Existing accounts are migrated on backend startup without replacing credentials, favorites, progress, preferences, recordings or historical invoices. The old implicit Sports Premium add-on is absorbed into the new Premium package, which includes Sports; it is not charged twice. No additional purchases are invented during migration.

## Nova

Gemini Live remains the only model. `get_account_access` checks one target with its purchase options. `get_account_information` reads actual purchases, gender, subscriptions and calculated bills. The public tools read shared content, offers, libraries and plans. Tools give guidance; the customer confirms changes in the TV UI. Screen changes, including locked playback URLs, are pushed to the active Live session.

## Verification

Backend tests cover account isolation, lock enforcement, shared references, refunds, duplicate prevention, expiry, prorated charges, rollover, persistence and Nova's access/billing tools. The TV browser tests cover account/session behavior, keyboard navigation, invoices and library routes. `scripts/check-commerce-browser.cjs` covers actual purchase/cancel controls and billing against temporary accounts. `audit-tv-demo.cjs` compares rendered TV pages with the shared catalog.
