import assert from "node:assert/strict";
import test from "node:test";
import { GoogleGenAI } from "@google/genai";
import { geminiHttpOptions } from "../src/ai/gemini-config.js";
import { transcriptionModel } from "../src/ai/ai-models.js";

function createMockClient(statuses) {
  let calls = 0;
  const client = new GoogleGenAI({
    apiKey: "test-key",
    httpOptions: {
      ...geminiHttpOptions,
      retryOptions: {
        ...geminiHttpOptions.retryOptions,
        initialDelay: 0.001,
        maxDelay: 0.001,
        jitter: 0,
      },
      fetch: async () => {
        const status = statuses[Math.min(calls++, statuses.length - 1)];
        return new Response(JSON.stringify(status === 200
          ? { candidates: [{ content: { parts: [{ text: "hello" }] } }] }
          : { error: { code: status, message: "Test error" } }), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });
  return {
    generate: () => client.models.generateContent({
      model: transcriptionModel,
      contents: "test",
    }),
    calls: () => calls,
  };
}

test("recovers from temporary 503 responses", async () => {
  const client = createMockClient([503, 503, 200]);
  assert.equal((await client.generate()).text, "hello");
  assert.equal(client.calls(), 3);
});

test("persistent overload stops after four attempts", async () => {
  const client = createMockClient([503]);
  await assert.rejects(client.generate, { status: 503 });
  assert.equal(client.calls(), 4);
});

for (const status of [400, 401, 403, 404, 429]) {
  test(`does not retry HTTP ${status}`, async () => {
    const client = createMockClient([status]);
    await assert.rejects(client.generate, { status });
    assert.equal(client.calls(), 1);
  });
}
