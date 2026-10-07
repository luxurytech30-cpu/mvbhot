# TV catalog and navigation review

Reviewed on **2026-10-03** against the actual TV application in `../../../hot`.

## Evidence

Read the router, rendered page components, shared controls, account state, and the data modules actually imported by those pages. Did not use `nova-tv-public-data.json`, `nova-tv-all-information.json`, or the unused simplified `navigationGraph.ts` as evidence.

Then ran `backend/scripts/audit-tv-demo.cjs` against an isolated TV instance and backend with temporary in-memory accounts. The user's saved accounts and normal development servers were not changed by the audit.

The browser audit passed **213 page visits**, with no browser errors:

| Area | Verified |
| --- | --- |
| VOD | All 12 titles, descriptions, playback titles and all eight filters |
| Channels | All 14 channel details, current/next demo labels and live player titles |
| CatchUp and guide | All 42 programs, program details/playback, channel program lists, category filters and displayed guide date |
| Apps | All nine apps, names, taglines and local details pages |
| Settings | All eight categories and all 11 option routes, selectable values, network/system information and current account profile |
| Home | Featured carousel, details and playback |
| Service | Four support popups, three plan cards and four library destinations |
| Account | Premium, Family and Basic accounts, displayed plans, favorites and empty recording lists |
| Billing | Account invoice links, invoice details, popup viewing and HTML downloads |
| Player | Hidden/revealed controls, subtitle choices, direct audio, nested audio/video/speed panels and correct closing destinations |
| Shared controls | Search keyboard/results, menu from the player, account entry, notification popup, logout and not-found recovery |

The detailed local report is generated at `artifacts/tv-audit/report.json` and ignored by Git.

## Changes

- `tv-catalog.json` is a standalone public facts catalog. Removed its competing `navigation`, `navigationGraph` and unused `assets` sections.
- Added Network, Account and System settings. Added public explanations of login, recordings, preferences, playback, invoices and the actual limits of the demonstration.
- Distinguished dated guide/current-program labels, fixed quality/age badges and decorative support controls from real service information.
- `navigation-graph.json` is the sole screen/action map: 64 pages, panels and logical states. It covers the actual account logout/login controls and subscription selection.
- Corrected account invoice navigation to open details before the invoice popup.
- Corrected subtitle closing and distinguished direct audio from audio opened through player settings.
- Recognized direct settings option URLs and the `הכל` filter as the unfiltered catalog page. Corrected VOD title `live-music`, which was previously mistaken for a live-channel route.
- Preference selections and search results have no separate canonical URL. Removed duplicate route patterns that could falsely imply the backend knew those selections.
- Navigation tools return destination controls and choices, including when already on the destination page. They avoid selecting nonexistent favorites, recordings or invoices in an empty account.
- Removed the export-copying `sync-tv-catalog.js` script and its documentation references. Startup and data tools use Nova's own JSON files. Plan prices remain shared with the backend plan module used by the TV API.

## Maintaining the data

After a TV feature changes, inspect its rendered page and controls, update the relevant Nova data file, and rerun backend tests and the browser audit. There is no automatic import of TV export files.

From `backend`, with the TV and API available: `node scripts/audit-tv-demo.cjs`. `NOVA_TV_URL` selects the website; `NOVA_DEMO_DIR` only locates the already installed Playwright browser-testing dependency. The audit signs in/out with demo accounts and does not change their subscriptions, favorites or selected preferences.

The backend receives the customer's latest **route**, not screenshots, focus or all local UI state. Live setup includes that route, and changes are pushed immediately to that account's open Gemini sessions without requesting a spoken response. Changes during connection setup or resumption are sent once ready. Current-screen questions can use this supplied context directly; navigation tools still read the latest route for exact steps. Open side menus, notifications, invoice popups, typed search text and hidden player controls do not change the route. Player panels with query parameters do. Nova must not claim to see unreported states. Actual personal values come from the authenticated account, never this public catalog.

## Shared access and billing update

The later 2026-10-03 update makes the backend catalog the source for both TV and Nova through the API. It holds 27 canonical content records, 14 channels, 42 program references, 8 VOD libraries and 17 purchase offers. Plans and offers define memberships; the backend enforces account access and calculates current-month invoices. Program metadata is no longer copied into separate TV arrays. The unused TV navigationGraph.ts was removed.

The latest full rendered audit passed 222 page visits and 15 interaction groups with no browser errors. Separate commerce checks cover purchases, refunds, monthly cancellation, a single match, libraries, gender, package changes, October invoice download and account isolation. See [access and billing](access-and-billing.md).
