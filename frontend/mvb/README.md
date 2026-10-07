# Nova Live frontend

`npm.cmd ci`, then `npm.cmd run dev`. Open `http://127.0.0.1:5173`; run the backend on 5000. Development HTTP/WebSocket `/api` requests are proxied to it. `VITE_API_URL` can override the origin. Deployed builds need an API reverse proxy and matching origin policy.

| File or folder | Responsibility |
| --- | --- |
| `src/App.tsx` | Arrange the account gate, conversation and answer UI |
| `src/types/assistant.ts` | Shared shapes for answers, navigation steps, cards and invoices |
| `src/hooks/useAccountSession.ts` | Session requests, login/logout and account refresh |
| `src/components/account/AccountGate.tsx` | Render sign-in and the current account bar |
| `src/hooks/useLiveVoice.ts` | Manage the WebSocket conversation and React state |
| `src/audio/live-audio.ts` | Capture microphone PCM, schedule playback and release audio resources |
| `src/components/live-voice/LiveVoice.tsx` | Render the call button, state and transcripts |
| `public/nova-microphone.js` | AudioWorklet: mono 16kHz PCM in 512-sample / 32ms chunks |
| `src/components/answer-details/AnswerDetails.tsx` | Render selected information cards |
| `src/components/answer-details/InvoiceStatement.tsx` | Render and print an exact invoice |

Microphone permission requires localhost or HTTPS. Voice streams to `/api/live`; Gemini Live alone generates speech/transcription. No upload/text pipeline or browser API key.

Queues are bounded. Interruptions clear scheduled audio. Unmount/account switch closes capture, nodes and sockets. Resumption displays a reconnecting state. Account state refreshes on window focus; same-origin tabs announce login/logout.

Use the same hostname as the TV demo (5174). Ports share host cookies; localhost and 127.0.0.1 do not. Nova follows the customer's latest reported route for every navigation request; Home is the fallback until the TV connects.

Checks: `npm.cmd run build`; `npm.cmd run lint`.
