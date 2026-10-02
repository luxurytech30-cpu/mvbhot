import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { app } from "../src/index.js";
import { ai } from "../src/ai/ai-models.js";
import { userInformationForCategory } from "../src/information/private/user-info.js";

test("a typed personal question is routed through the user data answer and TTS", async t => {
  const calls = [];
  const logs = [];
  t.mock.method(console, "log", (...parts) => logs.push(parts.join(" ")));
  t.mock.method(ai.models, "generateContent", async request => {
    calls.push(request);
    if (request.config.responseModalities?.includes("AUDIO")) {
      return { candidates: [{ content: { parts: [{ inlineData: {
        mimeType: "audio/wav",
        data: Buffer.from("RIFF0000WAVE0000").toString("base64"),
      } }] } }] };
    }
    if (calls.length === 1) {
      return { text: JSON.stringify({ type: "user_data", category: "subscription" }) };
    }
    assert.ok(request.contents.includes(JSON.stringify(userInformationForCategory("subscription"))));
    assert.ok(!request.contents.includes(JSON.stringify(userInformationForCategory("profile"))));
    return { text: JSON.stringify({ answer: "Your plan is available in the account record.", displayIds: ["plan", "invented"] }) };
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "What is my plan?" }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.type, "user_data");
  assert.equal(result.answer, "Your plan is available in the account record.");
  assert.deepEqual(result.presentation.cards.map(card => card.id), ["plan"]);
  assert.equal(result.presentation.cards[0].title, userInformationForCategory("subscription").planName);
  assert.deepEqual(result.steps, []);
  assert.equal(result.currentScreen, null);
  assert.equal(result.audio.mimeType, "audio/wav");
  assert.equal(calls.length, 3);
  for (const action of ["Read typed message", "Validate message", "Classify request", "Select user data",
    "Prepare user display cards", "Generate user answer", "Prepare user presentation", "Generate speech",
    "Try TTS model", "Encode speech audio", "Send response"]) {
    assert.ok(logs.some(line => line.includes(action) && /completed in \d+\.\d{3} ms/.test(line)), action);
  }
  assert.ok(logs.some(line => /Request: completed in \d+\.\d{3} ms/.test(line)));
});

test("a billing answer includes exactly the requested source statement", async t => {
  let textCalls = 0;
  const invoices = userInformationForCategory("billing").invoices;
  const selected = invoices.filter(invoice => invoice.id === "2026-09");
  assert.ok(selected.length);
  t.mock.method(ai.models, "generateContent", async request => {
    if (request.config.responseModalities?.includes("AUDIO")) {
      return { candidates: [{ content: { parts: [{ inlineData: {
        mimeType: "audio/wav", data: Buffer.from("RIFF0000WAVE0000").toString("base64"),
      } }] } }] };
    }
    if (++textCalls === 1) return { text: JSON.stringify({ type: "user_data", category: "billing" }) };
    for (const invoice of selected) assert.ok(request.contents.includes(JSON.stringify(invoice)));
    for (const invoice of invoices.filter(invoice => !selected.includes(invoice))) assert.ok(!request.contents.includes(JSON.stringify(invoice)));
    return { text: JSON.stringify({ answer: "Here is your September bill.", displayIds: [] }) };
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Show my September 2026 bill" }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.answer, "Here is your September bill.");
  assert.deepEqual(result.presentation.invoices, selected);
  assert.equal(result.presentation.source, "user");
});
