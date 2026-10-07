import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import WebSocket from "ws";
import { createLiveConversation, interactionStatus } from "../src/live/live-conversation.js";
import { createAssistantServer } from "../src/server/create-server.js";

import { demoAccountTemplate } from "../src/accounts/demo-accounts.js";
import { createGeminiLiveConfig } from "../src/live/gemini-live-config.js";
import { createAccountStore } from "../src/accounts/account-store.js";
import { createLiveMetrics } from "../src/live/live-metrics.js";

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) {
    this.messages.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const result = {
  success: true,
  answer: "The answer",
  steps: [],
  presentation: { cards: [], invoices: [] },
};

test("account lookup failures have safe diagnostics and corrected arguments can recover", async () => {
  const socket = new Socket();
  const responses = [],
    events = [];
  let persistenceFailure = false;
  const bridge = createLiveConversation(socket, {
    getUser: () => {
      if (persistenceFailure) throw new Error("private account value and API key");
      return demoAccountTemplate;
    },
    metrics: createLiveMetrics({
      log: (line) => events.push(JSON.parse(line.slice(line.indexOf("{")))),
    }),
    connect: async () => ({
      close() {},
      sendToolResponse: (message) => responses.push(message.functionResponses[0].response),
    }),
  });
  socket.emit("message", Buffer.from(JSON.stringify({ type: "start" })), false);
  await tick();
  const ask = (fields) =>
    bridge.onmessage({
      toolCall: {
        functionCalls: [
          {
            id: String(responses.length),
            name: "get_account_information",
            args: { category: "subscription", question: "Check my plan", fields },
          },
        ],
      },
    });
  await ask(["inventedField"]);
  assert.equal(responses[0].code, "UNKNOWN_FIELD");
  assert.equal(events.find((event) => event.event === "tool_failed").code, "UNKNOWN_FIELD");
  assert.equal(socket.readyState, 1);
  await ask(["planName"]);
  assert.equal(responses[1].information.planName, demoAccountTemplate.subscription.planName);
  persistenceFailure = true;
  await ask(["planName"]);
  assert.equal(responses[2].code, "TOOL_EXECUTION_FAILED");
  assert.doesNotMatch(
    JSON.stringify({ responses, events }),
    /private account value|API key|inventedField/,
  );
  assert.equal(events.filter((event) => event.event === "tool_started").length, 3);
  assert.deepEqual(
    events.filter((event) => event.event === "tool_completed").map((event) => event.success),
    [false, true, false],
  );
  bridge.close();
});

test("screen changes during setup and reconnection send only the latest noninterrupting context", async () => {
  const socket = new Socket();
  let current = { imageName: "settings.png", path: "/settings" };
  let notify, finishConnect;
  const connections = [],
    updates = [];
  let unsubscribed = 0;
  const bridge = createLiveConversation(socket, {
    getContext: () => current,
    subscribeContext: (listener) => {
      notify = listener;
      return () => unsubscribed++;
    },
    connect: (options) => {
      connections.push(options);
      return new Promise((resolve) => {
        finishConnect = () =>
          resolve({
            close() {},
            sendClientContent: (message) => updates.push(message),
          });
      });
    },
  });
  socket.emit("message", Buffer.from(JSON.stringify({ type: "start" })), false);
  assert.match(connections[0].config.systemInstruction, /"screenId":"settings"/);
  current = { imageName: "vod.png", path: "/vod" };
  notify();
  current = { imageName: "channels.png", path: "/channels" };
  notify();
  assert.equal(updates.length, 0);
  finishConnect();
  await tick();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].turnComplete, false);
  assert.match(updates[0].turns[0].parts[0].text, /"screenId":"channels"/);
  notify();
  assert.equal(updates.length, 1);
  await connections[0].callbacks.onmessage({
    sessionResumptionUpdate: { resumable: true, newHandle: "own-handle" },
  });
  connections[0].callbacks.onclose();
  current = { imageName: "account.png", path: "/account" };
  notify();
  current = { imageName: "home.png", path: "/" };
  notify();
  assert.equal(updates.length, 1);
  finishConnect();
  await tick();
  assert.equal(updates.length, 2);
  assert.match(updates[1].turns[0].parts[0].text, /"screenId":"home"/);
  bridge.close();
  notify();
  assert.equal(updates.length, 2);
  assert.equal(unsubscribed, 1);
});

test("an interrupted turn cannot publish its delayed tool result into the next turn", async () => {
  const socket = new Socket();
  let resolve;
  const responses = [];
  const bridge = createLiveConversation(socket, {
    connect: async () => ({
      close() {},
      sendToolResponse: (response) => responses.push(response),
    }),
    execute: () =>
      new Promise((finish) => {
        resolve = finish;
      }),
  });
  socket.emit(
    "message",
    Buffer.from(JSON.stringify({ type: "start", imageName: "home.png" })),
    false,
  );
  await tick();
  const pending = bridge.onmessage({
    toolCall: {
      functionCalls: [{ id: "old", name: "get_account_information", args: {} }],
    },
  });
  await bridge.onmessage({
    serverContent: {
      interrupted: true,
      interactionStatus: "IN_PROGRESS",
      outputTranscription: { text: "New reply" },
    },
  });
  resolve({
    result: { ...result, lookupId: "old" },
    response: { private: "stale" },
  });
  await pending;
  assert.equal(responses.length, 0);
  assert.equal(
    socket.messages.filter((message) => message.type === "result").at(-1).result.answer,
    "New reply",
  );
  bridge.close();
});

test("Live config selects model-compatible tools, reasoning and interaction status locations", () => {
  const config = createGeminiLiveConfig({ model: "gemini-3.8-live-extended-thinking" });
  assert.equal(config.tools[0].functionDeclarations[0].behavior, "NON_BLOCKING");
  assert.deepEqual(config.responseModalities, ["AUDIO"]);
  assert.match(config.systemInstruction, /latest TV screen reported/);
  const standard = createGeminiLiveConfig({ model: "gemini-3.8-live" });
  assert.equal(standard.thinkingConfig, undefined);
  assert.ok(standard.tools[0].functionDeclarations.every((tool) => tool.behavior === "BLOCKING"));
  for (const message of [
    { interactionStatus: "IDLE" },
    { interaction_status: "IDLE" },
    { serverContent: { interactionStatus: "IDLE" } },
  ])
    assert.equal(interactionStatus(message), "IDLE");
});

test("navigation follows TV page changes during a call and ignores client screen choices", async () => {
  const socket = new Socket();
  const responses = [];
  let current = { imageName: "settings.png" };
  const bridge = createLiveConversation(socket, {
    getContext: () => current,
    connect: async () => ({
      close() {},
      sendToolResponse(message) {
        responses.push(message.functionResponses[0].response);
      },
    }),
  });
  socket.emit(
    "message",
    Buffer.from(JSON.stringify({ type: "start", imageName: "channels.png", followTv: false })),
    false,
  );
  await tick();
  assert.ok(socket.messages.some((message) => message.type === "ready"));
  const askRoute = (id) =>
    bridge.onmessage({
      toolCall: {
        functionCalls: [
          {
            id,
            name: "get_navigation_route",
            args: { question: "Go home", targetScreen: "home" },
          },
        ],
      },
    });
  await askRoute("first");
  assert.equal(responses[0].currentScreen, "settings");
  await bridge.onmessage({ serverContent: { interactionStatus: "IDLE" } });
  current = { imageName: "vod.png" };
  await askRoute("second");
  assert.equal(responses[1].currentScreen, "vod");
  bridge.close();
});

test("an interim utterance keeps the session alive for later tools and final audio", async () => {
  const socket = new Socket();
  let callbacks;
  let closed = 0;
  const responses = [];
  const bridge = createLiveConversation(socket, {
    model: "gemini-3.8-live-extended-thinking",
    getUser: () => demoAccountTemplate,
    connect: async (options) => {
      callbacks = options.callbacks;
      assert.equal(options.model, "gemini-3.8-live-extended-thinking");
      return {
        close: () => closed++,
        sendToolResponse: (response) => responses.push(response),
      };
    },
    execute: async (call) => {
      assert.equal(call.name, "get_account_information");
      return {
        result,
        response: { information: { planName: "NOVA Premium" } },
      };
    },
  });
  socket.emit(
    "message",
    Buffer.from(JSON.stringify({ type: "start", imageName: "home.png" })),
    false,
  );
  await tick();
  await callbacks.onmessage({
    serverContent: { turnComplete: true, interactionStatus: "IN_PROGRESS" },
  });
  assert.equal(closed, 0);
  await callbacks.onmessage({
    toolCall: {
      functionCalls: [
        {
          id: "one",
          name: "get_account_information",
          args: { question: "my plan" },
        },
      ],
    },
  });
  assert.equal(responses[0].functionResponses[0].response.information.planName, "NOVA Premium");
  assert.ok(socket.messages.some((message) => message.type === "result"));
  await callbacks.onmessage({
    serverContent: {
      modelTurn: {
        parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }],
      },
      interactionStatus: "IDLE",
      turnComplete: true,
    },
  });
  assert.ok(socket.messages.some((message) => message.type === "audio"));
  assert.deepEqual(
    socket.messages.filter((message) => message.type === "status").map((message) => message.status),
    ["IN_PROGRESS", "IDLE"],
  );
  bridge.close();
  assert.equal(closed, 1);
});

test("standard Live completes consecutive spoken turns without explicit interaction status", async () => {
  const socket = new Socket();
  const events = [];
  const bridge = createLiveConversation(socket, {
    model: "gemini-3.8-live",
    metrics: createLiveMetrics({
      log: (line) => events.push(JSON.parse(line.slice(line.indexOf("{")))),
    }),
    connect: async () => ({ close() {} }),
  });
  socket.emit("message", Buffer.from(JSON.stringify({ type: "start" })), false);
  await tick();
  for (const [question, answer] of [
    ["Hello", "Hi"],
    ["Thanks", "You are welcome"],
  ]) {
    await bridge.onmessage({ serverContent: { inputTranscription: { text: question } } });
    await bridge.onmessage({
      serverContent: {
        outputTranscription: { text: answer },
        modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] },
      },
    });
    await bridge.onmessage({ serverContent: { turnComplete: true } });
    const written = socket.messages.filter((message) => message.type === "result").at(-1).result;
    assert.equal(written.answer, answer);
    assert.equal(written.transcript, question);
  }
  assert.equal(events.filter((event) => event.event === "interaction_started").length, 2);
  assert.equal(events.filter((event) => event.event === "interaction_idle").length, 2);
  assert.equal(
    socket.messages.filter((message) => message.type === "status" && message.status === "IDLE")
      .length,
    2,
  );
  bridge.close();
});

test("standard Live keeps lookup cards until its final spoken answer", async () => {
  const socket = new Socket();
  const bridge = createLiveConversation(socket, {
    model: "gemini-3.8-live",
    getUser: () => demoAccountTemplate,
    connect: async () => ({ close() {}, sendToolResponse() {} }),
  });
  socket.emit("message", Buffer.from(JSON.stringify({ type: "start" })), false);
  await tick();
  await bridge.onmessage({
    toolCall: {
      functionCalls: [
        {
          id: "plan",
          name: "get_account_information",
          args: { category: "subscription", fields: ["planName"], question: "My plan" },
        },
      ],
    },
  });
  await bridge.onmessage({ serverContent: { turnComplete: true } });
  assert.ok(
    !socket.messages.some((message) => message.type === "status" && message.status === "IDLE"),
  );
  await bridge.onmessage({
    serverContent: {
      outputTranscription: { text: "Your plan is NOVA Premium" },
      modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] },
      turnComplete: true,
    },
  });
  const written = socket.messages.filter((message) => message.type === "result").at(-1).result;
  assert.equal(written.presentation.cards[0].id, "plan");
  assert.equal(written.answer, "Your plan is NOVA Premium");
  assert.equal(
    socket.messages.filter((message) => message.type === "status" && message.status === "IDLE")
      .length,
    1,
  );
  bridge.close();
});

test("cancelled tools and disconnected sessions cannot publish stale answers", async () => {
  const socket = new Socket();
  let finish;
  const responses = [];
  const bridge = createLiveConversation(socket, {
    getUser: () => demoAccountTemplate,
    connect: async () => ({
      close() {},
      sendToolResponse: (response) => responses.push(response),
    }),
    execute: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  socket.emit(
    "message",
    Buffer.from(JSON.stringify({ type: "start", imageName: "home.png" })),
    false,
  );
  await tick();
  const pending = bridge.onmessage({
    toolCall: {
      functionCalls: [
        {
          id: "cancel",
          name: "get_account_information",
          args: { question: "my bill" },
        },
      ],
    },
  });
  await bridge.onmessage({ toolCallCancellation: { ids: ["cancel"] } });
  finish({ result, response: {} });
  await pending;
  assert.equal(responses.length, 0);
  assert.ok(
    !socket.messages.some(
      (message) => message.type === "result" && message.result.answer === "The answer",
    ),
  );
  bridge.close();
});

test("disconnect while connecting closes the late provider session", async () => {
  const socket = new Socket();
  let finish;
  let closes = 0;
  createLiveConversation(socket, {
    getUser: () => demoAccountTemplate,
    connect: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  socket.emit(
    "message",
    Buffer.from(JSON.stringify({ type: "start", imageName: "home.png" })),
    false,
  );
  socket.close();
  finish({ close: () => closes++ });
  await tick();
  assert.equal(closes, 1);
  assert.ok(!socket.messages.some((message) => message.type === "ready"));
});

test("real WebSocket transport forwards microphone PCM and closes both connections", async (t) => {
  const audio = [];
  let closes = 0;
  const server = createAssistantServer({
    store: createAccountStore({ file: null }),
    connect: async () => ({
      close: () => closes++,
      sendRealtimeInput: (message) => audio.push(message),
    }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const removedEndpoint = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "my plan" }),
  });
  assert.equal(removedEndpoint.status, 404);
  const login = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "premium@nova.demo",
      password: "NovaDemo123!",
    }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/live`, {
    headers: { Cookie: cookie },
  });
  await once(client, "open");
  client.send(JSON.stringify({ type: "start", imageName: "home.png" }));
  const [ready] = await once(client, "message");
  assert.equal(JSON.parse(ready.toString()).type, "ready");
  client.send(JSON.stringify({ type: "audio", data: "AAAAAA==" }));
  // A subsequent stop is processed in order after the audio frame.
  client.send(JSON.stringify({ type: "stop" }));
  await once(client, "close");
  assert.deepEqual(audio, [{ audio: { data: "AAAAAA==", mimeType: "audio/pcm;rate=16000" } }]);
  assert.equal(closes, 1);
});

test("the live model's transcript becomes the written answer, including answers without tools", async () => {
  const socket = new Socket();
  const bridge = createLiveConversation(socket, {
    getUser: () => demoAccountTemplate,
    connect: async () => ({ close() {}, sendToolResponse() {} }),
  });
  socket.emit(
    "message",
    Buffer.from(JSON.stringify({ type: "start", imageName: "home.png" })),
    false,
  );
  await tick();
  await bridge.onmessage({
    serverContent: { inputTranscription: { text: "Hello" } },
  });
  await bridge.onmessage({
    serverContent: {
      interactionStatus: "IN_PROGRESS",
      outputTranscription: { text: "Hi! " },
    },
  });
  await bridge.onmessage({
    serverContent: {
      interactionStatus: "IDLE",
      outputTranscription: { text: "How can I help?" },
      turnComplete: true,
    },
  });
  const written = socket.messages.filter((message) => message.type === "result").at(-1).result;
  assert.equal(written.answer, "Hi! How can I help?");
  assert.equal(written.transcript, "Hello");
  assert.equal(written.presentation, null);
  bridge.close();
});

test("direct data cards survive spoken-answer updates and interruption clears the previous answer", async () => {
  const socket = new Socket();
  const responses = [];
  const bridge = createLiveConversation(socket, {
    getUser: () => demoAccountTemplate,
    connect: async () => ({
      close() {},
      sendToolResponse: (response) => responses.push(response),
    }),
  });
  socket.emit(
    "message",
    Buffer.from(JSON.stringify({ type: "start", imageName: "home.png" })),
    false,
  );
  await tick();
  await bridge.onmessage({
    toolCall: {
      functionCalls: [
        {
          id: "plan",
          name: "get_account_information",
          args: {
            question: "What is my plan?",
            category: "subscription",
            fields: ["planName"],
          },
        },
      ],
    },
  });
  assert.ok(responses[0].functionResponses[0].response.information.planName);
  await bridge.onmessage({
    serverContent: {
      outputTranscription: { text: "Your plan is NOVA Premium." },
    },
  });
  let written = socket.messages.filter((message) => message.type === "result").at(-1).result;
  assert.equal(written.presentation.cards[0].id, "plan");
  assert.equal(written.answer, "Your plan is NOVA Premium.");
  await bridge.onmessage({
    serverContent: { interactionStatus: "IDLE", turnComplete: true },
  });
  // Transcription is independent of turn boundaries and may arrive after IDLE.
  await bridge.onmessage({
    serverContent: { outputTranscription: { text: "Anything else?" } },
  });
  written = socket.messages.filter((message) => message.type === "result").at(-1).result;
  assert.equal(written.presentation.cards[0].id, "plan");
  assert.match(written.answer, /Your plan is NOVA Premium/);
  await bridge.onmessage({
    serverContent: { interrupted: true, interactionStatus: "IN_PROGRESS" },
  });
  await bridge.onmessage({
    serverContent: {
      outputTranscription: { text: "What would you like to know?" },
      interactionStatus: "IDLE",
    },
  });
  written = socket.messages.filter((message) => message.type === "result").at(-1).result;
  assert.equal(written.answer, "What would you like to know?");
  assert.equal(written.presentation, null);
  bridge.close();
});
