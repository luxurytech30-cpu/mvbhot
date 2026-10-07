# Shared account and Live backend

Node 22+; `npm.cmd run dev`. Keep the Gemini API key in `.env`. Default model: `gemini-3.8-live`, with blocking tools. Port: 5000. `APP_ORIGINS` sets allowed frontend origins. Extended Thinking remains available by setting `GEMINI_LIVE_MODEL=gemini-3.8-live-extended-thinking` and optionally `GEMINI_LIVE_THINKING_LEVEL=low|medium|high`.

| File or folder | Responsibility |
| --- | --- |
| `src/index.js` | Start the server on the configured port |
| `src/server/create-server.js` | Connect the account HTTP routes and Live WebSocket server |
| `src/accounts/account-routes.js` | Login/logout, account operations, CORS and TV page reports |
| `src/accounts/account-store.js` | Password checks, sessions, latest TV context and atomic account persistence |
| `src/accounts/account-changes.js` | Validate and apply favorites, preferences, progress, recordings and plan changes |
| `src/accounts/account-commerce.js` | Purchase/cancel operations, plan changes, profile gender and playback authorization |
| `src/accounts/account-access.js` | Per-account VOD/channel/library/CatchUp entitlements and purchase options |
| `src/accounts/account-billing.js` | Monthly ledger, prorated charges, credits and generated invoices |
| `src/accounts/demo-accounts.js` | Create the three initial demo accounts |
| `src/accounts/demo-account-template.json` | Starting data for new demo accounts; existing accounts live in `data/accounts.json` |
| `src/accounts/account-information.js` | Read selected account categories and resolve library labels |
| `src/accounts/subscription-plans.js` | Shared plan names, prices and add-ons |
| `src/live/gemini-live-config.js` | Gemini settings, voice, language instructions and tool catalog |
| `src/live/live-websocket-server.js` | Authenticate browser connections, enforce limits and close expired calls |
| `src/live/live-conversation.js` | Forward audio/transcripts, manage turns, interruptions and tool responses |
| `src/live/gemini-live-connection.js` | Connect/resume Gemini with private handles and bounded retries |
| `src/live/live-metrics.js` | Measure setup, tool and audio timing |
| `src/tools/tool-definitions.js` | Describe the available tools and their arguments to Gemini |
| `src/tools/assistant-tools.js` | Execute local navigation, public-data and account-data tools |
| `src/information/public-catalog.js` and `tv-catalog.json` | Load and select public NOVA TV facts |
| `src/information/catalog-data.js` and `catalog-validation.js` | Validate shared catalog references, resolve programs/channels and supply TV data |
| `src/navigation/navigation-routes.js` and `navigation-graph.json` | Recognize TV URLs and calculate navigation instructions |
| `src/presentation/information-cards.js` | Convert selected data into display cards |
| `src/presentation/invoice-selection.js` | Select exact invoices for a question |
| `src/presentation/answer-presentation.js` | Choose the display title, cards and invoice results |

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Readiness |
| `GET /api/demo` | Public account choices, plans and shared TV catalog |
| `POST /api/auth/login` | Sign in; set HttpOnly, SameSite cookie |
| `GET /api/auth/session` | Current user's record |
| `POST /api/auth/logout` | Invalidate session and close its calls |
| `PATCH /api/account` | One validated favorite, recording, progress, preference or subscription operation |
| `POST /api/playback` | Authorize a content/channel/program for this account and record first use of a one-time purchase |
| `GET/PATCH /api/context` | That user's latest reported screen |
| `WS /api/live` | Authenticated Live voice |

Legacy typed-question, recorded-audio, STT/TTS and second-model endpoints remain removed. Unknown endpoints return 404.

Sessions expire after 12 hours; restarting signs users out. Accounts persist in ignored `backend/data/accounts.json`. This JSON store is for a single-process local demo, not a production database. Access is enforced by the backend. Payments and playback remain simulated. Current-month bills are generated from ledger charges/credits; historical bills remain unchanged. See [access and billing](../docs/access-and-billing.md) for cancellation and proration rules.

## Conversation

1. Authenticate before connecting Gemini. Setup includes IDs/field names, no account values.
2. Live answers ordinary conversation directly and selects tools for TV facts, account questions and navigation.
3. Personal tools derive identity from the session, read the latest account and return only requested fields. The model cannot select another customer. Missing requested invoices remain unavailable.
4. Data produces cards/routes/invoices; speech transcription supplies the written answer.
5. Turn IDs discard delayed tool outcomes after interruption. Transcripts, input rate, transport queues, concurrent calls and snapshots are bounded.
6. Context compression supports longer calls. Resumption reconnects the same provider conversation with a private handle and two bounded attempts. Input pauses during resumption. Without a handle the call ends with a restart message. Demo calls have a 30-minute cap.

Hebrew is the default; only explicit requests switch language. This is a model instruction, not a hard filter.

Navigation tracks the latest route reported for the user, not screenshots, focus or dialogs without route changes. Multiple TV tabs for one account share this route. Live setup includes the current page; every changed route is immediately pushed to that account's open Gemini sessions with `turnComplete: false`, without requesting speech or interrupting an answer. Changes during setup or reconnection are sent when the connection is ready. Gemini can answer current-screen questions directly; navigation tools still read the latest route for exact steps. Tools give guidance and do not operate the TV or change an account.

## Checks and catalogs

`npm.cmd test`; `node scripts/check-gemini-live.js`; `node scripts/check-live-tools.js` (real tool round trip with a synthetic in-memory account); `node scripts/check-live-tools.js --all-invoices` (requires all available demo invoices); `node scripts/measure-live-latency.js` (public text benchmark, not microphone/VAD latency). The tool diagnostic supports `--minimal` for a harmless echo tool and `--model=...` to compare provider models. It never reads saved accounts or writes purchases.

The October 4 diagnostic reproduced an Extended Thinking response saying a system error occurred without any `toolCall`, even with one harmless echo declaration. Standard Live called the same tool; a full Hebrew October invoice lookup also succeeded. Connection setup success alone therefore does not establish tool compatibility. Standard Live uses final `turnComplete` to finish a spoken interaction; Extended Thinking continues to use explicit `interactionStatus: IDLE` so intermediate utterances do not end processing.

Metrics record readiness, tool start/completion, safe tool error codes, session failure, first audio, first audio after tools and IDLE/interruption. Tool arguments and account values are not logged. Browser logs first playback. The historical [measurement](../docs/live-latency.json) is one sample, not a latency guarantee.

The backend owns `information/tv-catalog.json`, shared with the TV through `/api/demo`; Nova never imports TV export files. Plans, libraries, offers and content are defined in that catalog. `accounts/subscription-plans.js` exposes its plan records. `navigation/navigation-graph.json` describes UI actions and routes separately. `node scripts/audit-tv-demo.cjs` checks the actual TV website; `NOVA_TV_URL` sets its URL. `check-commerce-browser.cjs` exercises purchase/cancel operations only against the isolated browser-test API.

The public catalog excludes viewing progress because progress belongs to each saved account. Channel current/next labels and guide/program times are a dated demo snapshot, not live listings.

Provider references: [audio chunking/interruption](https://ai.google.dev/gemini-api/docs/live-api/best-practices), [compression/resumption](https://ai.google.dev/gemini-api/docs/live-api/session-management).

The catalog contains public facts and demo limitations; screen paths, menu actions and instructions belong only to the navigation graph. Navigation responses include destination controls, so how-to questions work even when the customer is already on the requested page. Local UI states and preference selections are not inferred from a URL.
