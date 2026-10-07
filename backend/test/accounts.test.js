import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createAccountStore } from "../src/accounts/account-store.js";
import { createAssistantServer } from "../src/server/create-server.js";
import { createAssistantTools } from "../src/tools/assistant-tools.js";
import { screenFromPath } from "../src/navigation/navigation-routes.js";

test("account changes persist independently, passwords are hashed, historical bills stay unchanged", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "nova-accounts-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "accounts.json");
  const store = createAccountStore({ file });
  const premium = await store.login("premium@nova.demo", "NovaDemo123!");
  const family = await store.login("family@nova.demo", "NovaDemo123!");
  const before = store.getUser(family.user.id);
  const execute = createAssistantTools("home.png", {
    getUser: () => store.getUser(family.user.id),
  });
  store.update(family.user.id, {
    operation: "favorite",
    kind: "content",
    id: "after-hours",
    userId: premium.user.id,
  });
  store.update(family.user.id, {
    operation: "preference",
    key: "language",
    value: "English",
  });
  store.update(family.user.id, { operation: "subscription", id: "nova-basic" });
  const selected = execute({
    id: "plan",
    name: "get_account_information",
    args: {
      category: "subscription",
      question: "my plan",
      fields: ["planName", "monthlyPrice"],
    },
  });
  assert.deepEqual(selected.response.information, {
    planName: "NOVA Basic",
    monthlyPrice: 79,
  });
  assert.deepEqual(
    store.getUser(family.user.id).billing.invoices.filter((item) => item.status !== "draft"),
    before.billing.invoices.filter((item) => item.status !== "draft"),
  );
  assert.notEqual(
    store.getUser(family.user.id).billing.invoices[0].total,
    before.billing.invoices[0].total,
  );
  assert.equal(store.getUser(premium.user.id).subscription.planName, "NOVA Premium");
  assert.ok(!store.getUser(premium.user.id).library.favoriteContentIds.includes("after-hours"));
  const savedAt = statSync(file, { bigint: true }).mtimeNs;
  const restored = createAccountStore({ file });
  assert.equal(statSync(file, { bigint: true }).mtimeNs, savedAt);
  assert.equal(restored.getUser(family.user.id).preferences.language, "English");
  assert.ok(restored.getUser(family.user.id).library.favoriteContentIds.includes("after-hours"));
  assert.ok(!readFileSync(file, "utf8").includes("NovaDemo123!"));
  await assert.rejects(store.login("premium@nova.demo", "wrong"), /incorrect/);
  assert.throws(
    () =>
      store.update(family.user.id, {
        operation: "preference",
        key: "__proto__",
        value: "English",
      }),
    /Invalid preference/,
  );
  assert.throws(
    () =>
      store.update(family.user.id, {
        operation: "preference",
        key: "language",
        value: "invented",
      }),
    /Invalid preference/,
  );
  assert.throws(
    () => store.update(family.user.id, { operation: "subscription", id: "fake" }),
    /Unknown subscription/,
  );
  assert.throws(
    () =>
      createAssistantTools("home.png")({
        name: "get_account_information",
        args: {
          category: "profile",
          fields: ["displayName"],
          question: "name",
        },
      }),
    /Sign in/,
  );
});

test("HTTP and live voice require a session, reject untrusted origins, and logout closes voice", async (t) => {
  const store = createAccountStore({ file: null });
  const server = createAssistantServer({
    store,
    connect: async () => ({ close() {}, sendRealtimeInput() {} }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/auth/session`)).status, 401);
  assert.equal((await fetch(`${base}/api/account`, { method: "PATCH" })).status, 401);
  assert.equal(
    (
      await fetch(`${base}/api/demo`, {
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  const anonymous = new WebSocket(base.replace("http:", "ws:") + "/api/live");
  const [error] = await once(anonymous, "error");
  assert.match(error.message, /401/);
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "basic@nova.demo",
      password: "NovaDemo123!",
    }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const headers = { Cookie: cookie, "Content-Type": "application/json" };
  const user = (await (await fetch(`${base}/api/auth/session`, { headers })).json()).user;
  assert.equal(user.subscription.planName, "NOVA Basic");
  assert.ok(!JSON.stringify(user).includes("passwordHash"));
  assert.equal(
    (
      await fetch(`${base}/api/context`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ path: "/settings/audio" }),
      })
    ).status,
    200,
  );
  assert.equal(store.getContext(user.id).imageName, "settings_sound.png");
  assert.equal(
    (
      await fetch(`${base}/api/context`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ path: "/unknown" }),
      })
    ).status,
    400,
  );
  const client = new WebSocket(base.replace("http:", "ws:") + "/api/live", {
    headers,
  });
  await once(client, "open");
  client.send(
    JSON.stringify({
      type: "start",
      imageName: "home.png",
      userId: "demo-user-001",
    }),
  );
  await once(client, "message");
  const disconnected = once(client, "close");
  assert.equal((await fetch(`${base}/api/auth/logout`, { method: "POST", headers })).status, 200);
  const [code] = await disconnected;
  assert.equal(code, 1008);
  assert.equal((await fetch(`${base}/api/auth/session`, { headers })).status, 401);
});

test("TV route recognition uses query parameters and specific players; navigation reads changing context", () => {
  assert.equal(screenFromPath("/player/live-11"), "live_player");
  assert.equal(screenFromPath("/player/program-11-1"), "program_player");
  assert.equal(screenFromPath("/player/horizon?panel=subtitles"), "subtitles");
  assert.equal(screenFromPath("/vod?category=films"), "vod_category");
  assert.equal(screenFromPath("/account"), "account");
  let context = { imageName: "settings.png" };
  const execute = createAssistantTools("home.png", { getContext: () => context });
  const call = {
    id: "route",
    name: "get_navigation_route",
    args: { question: "go home", targetScreen: "home" },
  };
  assert.equal(execute(call).result.currentScreen, "settings");
  context = { imageName: "channels.png" };
  assert.equal(execute(call).result.currentScreen, "channels");
});

test("TV HTTP updates immediately reach only that account's active Gemini sessions", async (t) => {
  const store = createAccountStore({ file: null });
  const first = await store.login("basic@nova.demo", "NovaDemo123!");
  const second = await store.login("family@nova.demo", "NovaDemo123!");
  store.setContext(first.user.id, { imageName: "settings.png", path: "/settings" });
  const providers = [];
  const server = createAssistantServer({
    store,
    connect: async (options) => {
      const provider = { options, updates: [] };
      let finishClose;
      provider.closed = new Promise((resolve) => {
        finishClose = resolve;
      });
      providers.push(provider);
      return { close: finishClose, sendClientContent: (message) => provider.updates.push(message) };
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const clients = [];
  t.after(async () => {
    await Promise.all(
      clients
        .filter((client) => client.readyState !== WebSocket.CLOSED)
        .map(async (client) => {
          const closed = once(client, "close");
          client.close();
          await closed;
        }),
    );
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const account of [first, first, second]) {
    const client = new WebSocket(base.replace("http:", "ws:") + "/api/live", {
      headers: { Cookie: `nova_session=${account.token}` },
    });
    clients.push(client);
    await once(client, "open");
    const ready = once(client, "message");
    client.send(JSON.stringify({ type: "start", imageName: "home.png" }));
    await ready;
  }
  assert.match(providers[0].options.config.systemInstruction, /"screenId":"settings"/);
  assert.match(providers[2].options.config.systemInstruction, /"reported":false/);
  const report = (account, path) =>
    fetch(`${base}/api/context`, {
      method: "PATCH",
      headers: { Cookie: `nova_session=${account.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  assert.equal((await report(first, "/vod")).status, 200);
  assert.deepEqual(
    providers.map((provider) => provider.updates.length),
    [1, 1, 0],
  );
  const update = providers[0].updates[0];
  assert.equal(update.turnComplete, false);
  assert.match(update.turns[0].parts[0].text, /"screenId":"vod"/);
  assert.equal((await report(first, "/vod")).status, 200);
  assert.deepEqual(
    providers.map((provider) => provider.updates.length),
    [1, 1, 0],
  );
  assert.equal((await report(second, "/account")).status, 200);
  assert.deepEqual(
    providers.map((provider) => provider.updates.length),
    [1, 1, 1],
  );
  assert.equal((await report(first, "/invalid")).status, 400);
  assert.deepEqual(
    providers.map((provider) => provider.updates.length),
    [1, 1, 1],
  );
  const closed = once(clients[0], "close");
  clients[0].close();
  await closed;
  await providers[0].closed;
  assert.equal((await report(first, "/settings")).status, 200);
  assert.deepEqual(
    providers.map((provider) => provider.updates.length),
    [1, 2, 1],
  );
});
