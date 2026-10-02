import test from "node:test";
import assert from "node:assert/strict";
import { ai } from "../src/ai/ai-models.js";
import { classifyRequest } from "../src/classify-and-answer.js";
import { answerInformation } from "../src/information/general/answer-information.js";
import { informationForCategory } from "../src/information/general/general-info.js";
import { answerUserInfo } from "../src/information/private/answer-user-info.js";
import { publicLabelsForUserCategory, userInformationForCategory } from "../src/information/private/user-info.js";

test("classification selects a valid navigation destination in one request", async t => {
  const calls = [];
  t.mock.method(ai.models, "generateContent", async request => {
    calls.push(request);
    return { text: JSON.stringify({ type: "navigation", targetScreen: "settings", userIntent: "הגדרות" }) };
  });

  const result = await classifyRequest("Open settings", "home.png");
  assert.deepEqual(result, { type: "navigation", targetScreen: "settings", userIntent: "הגדרות" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].contents, /Screen catalog:/);
  assert.match(calls[0].contents, /Information categories:/);
  assert.match(calls[0].contents, /User information categories:/);
  assert.ok(!calls[0].contents.includes(JSON.stringify(userInformationForCategory("profile"))));
});

test("classification selects a user data category without exposing the data", async t => {
  let prompt;
  t.mock.method(ai.models, "generateContent", async request => {
    prompt = request.contents;
    return { text: JSON.stringify({ type: "user_data", category: "subscription" }) };
  });

  assert.deepEqual(await classifyRequest("What is my plan?", "home.png"), {
    type: "user_data",
    category: "subscription",
  });
  assert.match(prompt, /User information categories:/);
  assert.ok(!prompt.includes(JSON.stringify(userInformationForCategory("subscription"))));
});

test("classification selects a valid information category", async t => {
  t.mock.method(ai.models, "generateContent", async () => ({
    text: JSON.stringify({ type: "answer", category: "service" }),
  }));

  assert.deepEqual(await classifyRequest("What packages are available?", "home.png"), {
    type: "answer",
    category: "service",
  });
});

test("unrecognized model selections cannot access arbitrary data or screens", async t => {
  let response = { type: "answer", category: "assets" };
  t.mock.method(ai.models, "generateContent", async () => ({
    text: JSON.stringify(response),
  }));
  assert.deepEqual(await classifyRequest("Tell me about this", "home.png"), {
    type: "answer",
    category: null,
  });
  assert.equal(informationForCategory("assets"), null);
  response = { type: "navigation", targetScreen: "invented-screen" };
  assert.deepEqual(await classifyRequest("Open an invented screen", "home.png"), {
    type: "navigation",
    targetScreen: null,
    userIntent: "Open an invented screen",
  });
  response = { type: "user_data", category: "id" };
  assert.deepEqual(await classifyRequest("Tell me my data", "home.png"), {
    type: "user_data",
    category: null,
  });
  assert.equal(userInformationForCategory("id"), null);
});

test("information answer receives the selected data section", async t => {
  let prompt;
  t.mock.method(ai.models, "generateContent", async request => {
    prompt = request.contents;
    return { text: JSON.stringify({ answer: "Available packages are listed in the service section." }) };
  });

  const answer = await answerInformation({ message: "What packages are available?", category: "service" });
  assert.equal(answer.answer, "Available packages are listed in the service section.");
  assert.match(prompt, /Selected information category: "service"/);
  assert.ok(prompt.includes(JSON.stringify(informationForCategory("service"))));
  assert.ok(!prompt.includes(JSON.stringify(informationForCategory("content"))));
});

test("user answer receives only the selected personal section", async t => {
  let prompt;
  t.mock.method(ai.models, "generateContent", async request => {
    prompt = request.contents;
    return { text: JSON.stringify({ answer: "Your plan details are in the selected record." }) };
  });

  const answer = await answerUserInfo({ message: "What is my plan?", category: "subscription" });
  assert.equal(answer.answer, "Your plan details are in the selected record.");
  assert.ok(prompt.includes(JSON.stringify(userInformationForCategory("subscription"))));
  assert.ok(!prompt.includes(JSON.stringify(userInformationForCategory("billing"))));
  assert.ok(!prompt.includes(JSON.stringify(userInformationForCategory("profile"))));
});

test("library questions can resolve favorite IDs to public titles", () => {
  const labels = publicLabelsForUserCategory("library");
  assert.ok(Object.keys(labels.contentTitles).length > 0);
  assert.ok(Object.keys(labels.channelNames).length > 0);
  assert.equal(publicLabelsForUserCategory("billing"), null);
});
