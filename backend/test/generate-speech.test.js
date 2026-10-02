import test from "node:test";
import assert from "node:assert/strict";
import { ai, speechModels, speechVoiceStyles } from "../src/ai/ai-models.js";
import { generateSpeech } from "../src/audio/generate-speech.js";

const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(36)]);
const pcm = Buffer.from([1, 0, 2, 0]);
const audioResponse = (bytes, mimeType) => ({
  candidates: [{ content: { parts: [{ inlineData: { data: bytes.toString("base64"), mimeType } }] } }],
});

test("TTS tries the configured models in order and keeps a WAV header", async t => {
  assert.deepEqual(speechModels, process.env.GEMINI_TTS_MODELS.split(",").map(model => model.trim()));
  assert.deepEqual(speechVoiceStyles, process.env.GEMINI_TTS_VOICE_CONFIG_STYLES.split(",").map(style => style.trim()));
  const requests = [];
  const logs = [];
  const failures = [];
  t.mock.method(console, "log", (...parts) => logs.push(parts.join(" ")));
  t.mock.method(console, "error", (...parts) => failures.push(parts.join(" ")));
  t.mock.method(ai.models, "generateContent", async request => {
    requests.push(request);
    if (requests.length === 1) throw new Error("First model unavailable");
    return audioResponse(wav, "audio/wav");
  });
  const result = await generateSpeech("שלום");
  assert.deepEqual(requests.map(request => request.model), speechModels.slice(0, 2));
  assert.deepEqual(requests[0].config.speechConfig.voiceConfig,
    speechVoiceStyles[0] === "direct" ? { voice: "Kore" } : { prebuiltVoiceConfig: { voiceName: "Kore" } });
  assert.deepEqual(result, wav);
  assert.ok(failures.some(line => line.includes(speechModels[0]) && /failed after \d+\.\d{3} ms/.test(line)));
  assert.ok(logs.some(line => line.includes(speechModels[1]) && /completed in \d+\.\d{3} ms/.test(line)));
});

test("TTS falls through empty audio and wraps legacy PCM as WAV", async t => {
  const requests = [];
  t.mock.method(ai.models, "generateContent", async request => {
    requests.push(request);
    if (requests.length < 4) return { candidates: [] };
    return audioResponse(pcm, "audio/L16;rate=24000");
  });
  t.mock.method(console, "error", () => {});

  const result = await generateSpeech("שלום");
  assert.deepEqual(requests.map(request => request.model), speechModels);
  assert.deepEqual(requests[3].config.speechConfig.voiceConfig, {
    prebuiltVoiceConfig: { voiceName: "Kore" },
  });
  assert.equal(result.toString("ascii", 0, 4), "RIFF");
  assert.deepEqual(result.subarray(44), pcm);
});

test("TTS reports failure only after trying every model", async t => {
  const requests = [];
  t.mock.method(ai.models, "generateContent", async request => {
    requests.push(request);
    throw new Error("Unavailable");
  });
  t.mock.method(console, "error", () => {});

  await assert.rejects(generateSpeech("שלום"), AggregateError);
  assert.deepEqual(requests.map(request => request.model), speechModels);
});
