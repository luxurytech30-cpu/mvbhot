# Information cards and billing statements

Information answers include source-backed display cards selected for the question. Personal answers use the relevant category in `backend/src/information/private/user-info.json`; website answers use `backend/src/information/general/data_general_info.json`.

`backend/src/information/answer-presentation.js` prepares card data. `frontend/mvb/src/components/answer-details/AnswerDetails.tsx` renders the cards and statements, with styles beside it.

Billing questions also display an RTL NOVA TV statement with line items, credits, payment status, and totals from the account file. A requested month or invoice reference selects matching records; an unspecified bill uses the latest stored statement. Missing months are reported as unavailable. Each statement has a print/save-as-PDF button.

Run local checks with `npm test` in `backend` and `npm run build` in `frontend/mvb`. Backend tests mock model calls and do not send account data to external services.
