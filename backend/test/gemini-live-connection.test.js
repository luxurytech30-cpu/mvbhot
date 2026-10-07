import test from "node:test";
import assert from "node:assert/strict";
import { connectGeminiLive } from "../src/live/gemini-live-connection.js";
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("provider reconnects with its own resume handle and ignores old callbacks", async () => {
  const connections = [],
    messages = [],
    audio = [],
    failures = [];
  let ready = 0,
    reconnects = 0,
    closes = 0;
  const session = await connectGeminiLive({
    model: "live",
    config: {},
    connect: async (options) => {
      connections.push(options);
      return {
        close: () => closes++,
        sendRealtimeInput: (input) => audio.push(input),
        sendToolResponse() {},
      };
    },
    onmessage: (message) => messages.push(message),
    onReconnect: () => reconnects++,
    onReady: () => ready++,
    onFailure: (error) => failures.push(error),
  });
  await connections[0].callbacks.onmessage({
    sessionResumptionUpdate: { resumable: true, newHandle: "private-handle" },
  });
  await connections[0].callbacks.onmessage({ goAway: { timeLeft: "30s" } });
  await tick();
  assert.equal(connections.length, 2);
  assert.deepEqual(connections[1].config.sessionResumption, {
    handle: "private-handle",
  });
  assert.equal(reconnects, 1);
  assert.equal(ready, 1);
  connections[0].callbacks.onclose();
  await connections[0].callbacks.onmessage({
    serverContent: { text: "stale" },
  });
  assert.equal(messages.length, 2);
  assert.equal(failures.length, 0);
  session.sendRealtimeInput({ audio: "new" });
  assert.deepEqual(audio, [{ audio: "new" }]);
  session.close();
  assert.equal(closes, 2);
});

test("failed resumption retries are bounded and a missing handle never creates a fresh conversation", async () => {
  let callbacks,
    calls = 0;
  const failures = [];
  const session = await connectGeminiLive({
    model: "live",
    config: {},
    connect: async (options) => {
      calls++;
      callbacks = options.callbacks;
      if (calls > 1) throw new Error("Network failure");
      return { close() {} };
    },
    onmessage() {},
    onReconnect() {},
    onReady() {},
    onFailure: (error) => failures.push(error),
  });
  await callbacks.onmessage({
    sessionResumptionUpdate: { resumable: true, newHandle: "own-handle" },
  });
  callbacks.onclose();
  await tick();
  assert.equal(calls, 3);
  assert.equal(failures.length, 1);
  session.close();
});
