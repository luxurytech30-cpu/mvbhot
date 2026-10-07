import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountStore } from "../src/accounts/account-store.js";
import { createAssistantTools } from "../src/tools/assistant-tools.js";
import { catalog, publicTVData } from "../src/information/catalog-data.js";
import { money } from "../src/accounts/account-billing.js";

async function fixture(file = null) {
  let now = new Date("2026-10-03T10:00:00Z");
  const store = createAccountStore({ file, clock: () => now });
  const accounts = {};
  for (const plan of ["basic", "family", "premium"])
    accounts[plan] = (await store.login(`${plan}@nova.demo`, "NovaDemo123!")).user.id;
  return {
    store,
    accounts,
    advance: (date) => {
      now = new Date(date);
    },
  };
}
const entry = (user, field, id) => user.access[field].find((item) => item.id === id);
const bill = (user) => user.billing.invoices.find((item) => item.id === "2026-10");
const buy = (store, id, offerId) => store.update(id, { operation: "purchase", id: offerId });

test("one catalog resolves every VOD, channel and CatchUp reference without copied title data", () => {
  const data = publicTVData();
  const content = new Map(catalog.content.map((item) => [item.id, item]));
  for (const program of catalog.programs) {
    assert.ok(content.has(program.contentId));
    assert.equal(Object.hasOwn(program, "title"), false);
    assert.ok(catalog.channels.some((channel) => channel.id === program.channelId));
    const timestamp = (date, time) => {
      const [day, month, year] = date.split(".").map(Number);
      const [hour, minute] = time.split(":").map(Number);
      return Date.UTC(year, month - 1, day, hour, minute);
    };
    assert.equal((timestamp(program.endDate, program.end) - timestamp(program.date, program.start)) / 60000,
      content.get(program.contentId).duration, `${program.id}: guide disagrees with title duration`);
    assert.equal(
      data.programs.find((item) => item.id === program.id).title,
      content.get(program.contentId).title,
    );
  }
  for (const channel of data.channels) {
    assert.equal(
      channel.current,
      data.programs.find((item) => item.id === channel.currentProgramId).title,
    );
    assert.equal(
      channel.next,
      data.programs.find((item) => item.id === channel.nextProgramId).title,
    );
  }
  for (const library of catalog.libraries)
    for (const id of library.contentIds) {
      assert.ok(content.get(id)?.libraryIds.includes(library.id));
    }
  for (const plan of catalog.plans) {
    for (const id of plan.channelIds) assert.ok(catalog.channels.some((item) => item.id === id));
    for (const id of plan.libraryIds) assert.ok(catalog.libraries.some((item) => item.id === id));
  }
});

test("universal access, package access and locks are account-specific and cannot be bypassed by a player URL", async () => {
  const { store, accounts } = await fixture();
  for (const id of Object.values(accounts)) {
    const user = store.getUser(id);
    for (const channel of catalog.accessPolicy.baseChannelIds)
      assert.equal(entry(user, "channels", channel).allowed, true);
    assert.equal(entry(user, "content", "horizon").allowed, true);
    assert.equal(entry(user, "content", "beyond").allowed, false);
    assert.equal(bill(user).total, user.subscription.monthlyPrice);
    assert.equal(bill(user).status, "draft");
  }
  assert.equal(entry(store.getUser(accounts.basic), "channels", "18").allowed, false);
  assert.equal(entry(store.getUser(accounts.family), "channels", "18").allowed, true);
  assert.equal(entry(store.getUser(accounts.family), "channels", "55").allowed, false);
  assert.equal(entry(store.getUser(accounts.premium), "channels", "55").allowed, true);
  assert.throws(() => store.authorizePlayback(accounts.basic, { kind: "channel", id: "55" }), {
    status: 403,
  });
  assert.throws(() => store.authorizePlayback(accounts.basic, { kind: "content", id: "beyond" }), {
    status: 403,
  });
});

test("one-time match access follows the same content across VOD and CatchUp without opening the whole channel", async () => {
  const { store, accounts } = await fixture();
  const before = bill(store.getUser(accounts.basic)).total;
  const user = buy(store, accounts.basic, "event-match");
  const match = catalog.offers.find((item) => item.id === "event-match").contentIds[0];
  assert.equal(entry(user, "channels", "55").allowed, false);
  assert.equal(entry(user, "channels", "55").currentEvent.allowed, true);
  assert.equal(entry(user, "programs", "55-1").allowed, true);
  assert.equal(entry(user, "programs", "55-2").allowed, false);
  assert.equal(entry(user, "content", match).allowed, true);
  assert.equal(bill(user).total, before + 25);
  store.authorizePlayback(accounts.basic, { kind: "channel", id: "55" });
  assert.throws(() => store.authorizePlayback(accounts.basic, { kind: "program", id: "55-2" }), {
    status: 403,
  });
  assert.equal(entry(store.getUser(accounts.family), "programs", "55-1").allowed, false);
  const order = store.getUser(accounts.basic).purchases.items[0];
  assert.ok(order.usedAt);
  assert.throws(
    () => store.update(accounts.basic, { operation: "cancel_purchase", id: order.id }),
    { status: 409 },
  );
});

test("one-time cancellation creates an exact credit, closes access and prevents duplicate charges/refunds", async () => {
  const { store, accounts } = await fixture();
  const initial = bill(store.getUser(accounts.basic)).total;
  const user = buy(store, accounts.basic, "rental-beyond");
  assert.equal(entry(user, "content", "beyond").allowed, true);
  assert.equal(bill(user).total, initial + 19);
  assert.throws(() => buy(store, accounts.basic, "rental-beyond"), { status: 409 });
  const cancelled = store.update(accounts.basic, {
    operation: "cancel_purchase",
    id: user.purchases.items[0].id,
  });
  assert.equal(bill(cancelled).total, initial);
  assert.equal(entry(cancelled, "content", "beyond").allowed, false);
  assert.equal(bill(cancelled).items.at(-1).amountIncludingTax, -19);
  assert.throws(
    () =>
      store.update(accounts.basic, {
        operation: "cancel_purchase",
        id: user.purchases.items[0].id,
      }),
    { status: 409 },
  );
  assert.equal(bill(store.getUser(accounts.family)).total, 109);
});

test("monthly library purchase is prorated; cancellation retains paid access then stops charges and access next month", async () => {
  const { store, accounts, advance } = await fixture();
  const added = buy(store, accounts.basic, "library-cinema");
  const order = added.purchases.items[0];
  assert.equal(bill(added).total, money(79 + money((25 * 29) / 31)));
  assert.equal(entry(added, "content", "after-hours").allowed, true);
  assert.equal(entry(added, "channels", "18").allowed, false);
  assert.equal(entry(added, "programs", "18-1").allowed, true);
  assert.throws(() => buy(store, accounts.basic, "rental-after-hours"), { status: 409 });
  const cancelled = store.update(accounts.basic, { operation: "cancel_purchase", id: order.id });
  assert.equal(entry(cancelled, "content", "after-hours").allowed, true);
  assert.equal(bill(cancelled).total, bill(added).total);
  advance("2026-11-01T10:00:00Z");
  const november = store.getUser(accounts.basic);
  assert.equal(entry(november, "content", "after-hours").allowed, false);
  assert.equal(november.billing.invoices[0].total, 79);
  assert.equal(bill(november).total, bill(added).total);
  assert.equal(bill(november).status, "issued");
});

test("channel purchase opens its programs but does not grant unrelated VOD libraries", async () => {
  const { store, accounts } = await fixture();
  const user = buy(store, accounts.basic, "channel-18");
  assert.equal(entry(user, "channels", "18").allowed, true);
  assert.equal(entry(user, "programs", "18-1").allowed, true);
  assert.equal(entry(user, "content", "after-hours").allowed, false);
  assert.equal(entry(user, "libraries", "cinema").allowed, false);
});

test("plan change adds matching credits/charges, keeps historical bills and separate purchases, and cancellation stops renewal", async () => {
  const { store, accounts, advance } = await fixture();
  const before = store.getUser(accounts.basic);
  const added = buy(store, accounts.basic, "library-premiere");
  const switched = store.update(accounts.basic, { operation: "subscription", id: "nova-family" });
  assert.equal(switched.subscription.planName, "NOVA Family");
  assert.equal(entry(switched, "content", "beyond").allowed, true);
  assert.equal(switched.purchases.items.length, 1);
  assert.equal(
    bill(switched).total,
    money(bill(added).total - money((79 * 29) / 31) + money((109 * 29) / 31)),
  );
  assert.deepEqual(
    switched.billing.invoices.filter((item) => item.id !== "2026-10"),
    before.billing.invoices.filter((item) => item.id !== "2026-10"),
  );
  store.update(accounts.basic, { operation: "cancel_subscription" });
  assert.equal(entry(store.getUser(accounts.basic), "channels", "18").allowed, true);
  store.update(accounts.basic, { operation: "subscription", id: "nova-family" });
  assert.equal(store.getUser(accounts.basic).subscription.status, "פעיל בהדגמה");
  assert.equal(bill(store.getUser(accounts.basic)).total, bill(switched).total);
  store.update(accounts.basic, { operation: "cancel_subscription" });
  advance("2026-11-01T10:00:00Z");
  const november = store.getUser(accounts.basic);
  assert.equal(entry(november, "channels", "18").allowed, false);
  assert.equal(entry(november, "channels", "11").allowed, true);
  assert.equal(november.billing.invoices[0].total, 35);
});

test("persistent purchases and gender survive restart; Nova reads the same authorization and October bill", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "nova-commerce-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "accounts.json");
  const { store, accounts } = await fixture(file);
  buy(store, accounts.basic, "event-match");
  store.update(accounts.basic, { operation: "profile", key: "gender", value: "other" });
  assert.throws(
    () => store.update(accounts.basic, { operation: "profile", key: "gender", value: "bad" }),
    { status: 400 },
  );
  const restored = createAccountStore({ file, clock: () => new Date("2026-10-03T10:00:00Z") });
  const user = restored.getUser(accounts.basic);
  assert.equal(user.profile.gender, "other");
  const execute = createAssistantTools("home.png", {
    getUser: () => restored.getUser(accounts.basic),
  });
  const access = execute({
    id: "access",
    name: "get_account_access",
    args: { kind: "program", id: "55-1", question: "Can I watch the match?" },
  });
  assert.equal(access.response.information.allowed, true);
  const response = execute({
    id: "bill",
    name: "get_account_information",
    args: {
      category: "billing",
      fields: ["invoices", "currency"],
      question: "My October 2026 bill",
    },
  });
  assert.equal(response.response.information.invoices[0].total, 104);
  assert.equal(response.result.presentation.invoices[0].total, 104);
  assert.ok(!readFileSync(file, "utf8").includes("NovaDemo123!"));
});

test("expired rentals, invalid purchases and skipped billing months stay consistent", async () => {
  const { store, accounts, advance } = await fixture();
  const before = store.getUser(accounts.basic);
  assert.throws(() => buy(store, accounts.basic, "unknown"), { status: 400 });
  assert.deepEqual(store.getUser(accounts.basic).purchases, before.purchases);
  buy(store, accounts.basic, "rental-beyond");
  assert.throws(() => store.authorizePlayback(accounts.family, { kind: "content", id: "beyond" }), {
    status: 403,
  });
  advance("2026-10-05T10:00:01Z");
  assert.equal(entry(store.getUser(accounts.basic), "content", "beyond").allowed, false);
  assert.throws(() => store.authorizePlayback(accounts.basic, { kind: "content", id: "beyond" }), {
    status: 403,
  });
  advance("2026-12-01T10:00:00Z");
  const december = store.getUser(accounts.basic);
  assert.equal(december.billing.invoices[0].id, "2026-12");
  assert.equal(december.billing.invoices.find((item) => item.id === "2026-11").total, 79);
  assert.equal(bill(december).total, 98);
  assert.equal(bill(december).status, "issued");
});
