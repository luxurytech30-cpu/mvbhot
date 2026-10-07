import test from "node:test";
import assert from "node:assert/strict";
import { createLiveMetrics } from "../src/live/live-metrics.js";

test("timings distinguish initial audio from audio after a tool and reset for the next interaction", () => {
  let time = 0;
  const messages = [];
  const metrics = createLiveMetrics({
    now: () => time,
    log: (message) => messages.push(JSON.parse(message.slice(message.indexOf("{")))),
  });
  time = 100;
  metrics.ready();
  assert.equal(metrics.begin(), true);
  assert.equal(metrics.begin(), false);
  time = 120;
  metrics.audio();
  time = 150;
  metrics.tool("get_navigation_route", 0.5, true);
  time = 160;
  metrics.audio();
  metrics.audio();
  time = 200;
  metrics.finish();
  assert.equal(messages.find((message) => message.event === "session_ready").setupMs, 100);
  assert.equal(
    messages.find((message) => message.event === "first_audio").sinceProcessingStartedMs,
    20,
  );
  assert.equal(
    messages.find((message) => message.event === "first_audio_after_tool").sinceToolReturnedMs,
    10,
  );
  assert.equal(messages.filter((message) => message.event === "first_audio_after_tool").length, 1);
  assert.equal(
    messages.find((message) => message.event === "tool_completed").extraModelRequests,
    0,
  );
  time = 300;
  assert.equal(metrics.begin(), true);
  metrics.audio();
  metrics.finish();
  assert.equal(messages.filter((message) => message.event === "first_audio").length, 2);
});
