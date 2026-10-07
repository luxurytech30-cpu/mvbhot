# Information cards and billing statements

Nova's account tools read the signed-in user's current record from the account store. Public TV tools read `backend/src/information/tv-catalog.json`.

`backend/src/presentation/information-cards.js` creates cards from selected source fields. `invoice-selection.js` chooses bills matching the requested month, year or reference. `answer-presentation.js` selects the title, cards and invoice records sent to the browser.

The frontend renders cards in `components/answer-details/AnswerDetails.tsx` and invoices in `InvoiceStatement.tsx`. Shared data shapes are defined in `src/types/assistant.ts`.

A requested month or reference selects matching records; an unspecified bill uses the latest stored statement. Missing months remain unavailable. Each statement supports printing or saving as PDF. Personal data readers require an account argument and do not fall back to the demo template.
