# Nova assistant frontend

Run `npm run dev` for local development, `npm run build` to compile, and `npm run lint` to check the code.

```text
src/
  main.tsx                            React entry point
  App.tsx, App.css                    Assistant form and response view
  index.css                           Global styles
  components/answer-details/         Information cards and invoice statement
  assets/                             Local images and icons
```

`App.tsx` receives the API's `presentation` object and passes it to `AnswerDetails.tsx`. The component renders selected information cards and any invoice statements supplied by the backend.
