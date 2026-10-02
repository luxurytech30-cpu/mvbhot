# Nova backend

Keep `.env` in the backend folder. Run `npm start` from that folder.

## Folders

```text
src/
  index.js                  HTTP API and request flow
  classify-and-answer.js    Classify each user request
  action-timer.js           Start, completion, and duration logs
  ai/                       Model setup and provider errors
  audio/                    Speech transcription and generation
  information/
    general/                 Website data and general answers
    private/                 User account data and personal answers
    answer-presentation.js   Card formatting shared by both answer types
  navigation/               Screen graph and route instructions
test/                        Local tests with mocked model calls
```

The JSON files sit beside the code that reads them: `src/information/general/data_general_info.json`, `src/information/private/user-info.json`, and `src/navigation/graph.json`.

`src/index.js` exposes `POST /api/assistant` and coordinates these actions:

1. `audio/transcribe-audio.js` uses Gemini to turn an uploaded recording into text. Typed requests skip this step.
2. `classify-and-answer.js` uses Gemma to classify the request as navigation, general information, or a question about the demo user's own data.
3. `information/general/answer-information.js` answers general questions from `information/general/data_general_info.json`. `information/private/answer-user-info.js` answers personal questions using only the selected section of `information/private/user-info.json`.
4. For navigation, `navigation/find-navigation-route.js` reads `navigation/graph.json` and finds the first shortest route. It owns the exact route actions and instructions.
5. `navigation/explain-navigation-route.js` sends that route and destination context to Gemma for a clearer written answer. If this call fails, `index.js` returns the graph's instructions.
6. `audio/generate-speech.js` tries the TTS models in `GEMINI_TTS_MODELS` order until one returns audio. `GEMINI_TTS_VOICE_CONFIG_STYLES` supplies a matching `direct` or `prebuilt` voice format for each model. If all fail, the written answer is still returned. WAV responses are preserved; raw PCM responses are wrapped as WAV.

`ai/ai-models.js` sets up the API client and model names. `ai/gemini-config.js` sets transient-error retries, and `ai/format-provider-error.js` formats API failures. The selected screen is sent to Gemma as an image **filename**, not image data.

All model names are required in `.env`: `GEMMA_MODEL`, `GEMINI_STT_MODEL`, and `GEMINI_TTS_MODELS`. Copy `.env.example` to set up a new local environment. The app reports a clear error if a required model setting is missing.

Each executed request action logs when it starts and how many milliseconds it takes, including data selection, answer generation, display preparation, TTS attempts, and sending the response. Logs carry a request ID so concurrent requests can be distinguished. Navigation actions are logged as planned steps because the assistant does not operate the TV itself.
