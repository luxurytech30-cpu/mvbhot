import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicCategoryCatalog } from "../src/information/public-catalog.js";
import { screenFromPath } from "../src/navigation/navigation-routes.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const publicData = read("../src/information/tv-catalog.json");
const graph = read("../src/navigation/navigation-graph.json");
const seed = read("../src/accounts/demo-account-template.json").user;

test("public facts contain no competing navigation map or personal account values", () => {
  for (const key of [
    "navigation",
    "navigationGraph",
    "assets",
    "user",
    "users",
    "accounts",
    "billing",
  ])
    assert.equal(Object.hasOwn(publicData, key), false, `Unexpected public category: ${key}`);
  assert.ok(
    !publicCategoryCatalog.some(({ id }) => ["navigation", "navigationGraph"].includes(id)),
  );
  assert.equal(publicData.guide.live, false);
  assert.equal(publicData.guide.date, "03.10.2026");
  assert.equal(screenFromPath("/vod?library=premiere"), "vod_library");
  assert.equal(screenFromPath("/player/beyond?access=locked"), "playback_access");
});

test("each public settings category and option is recognized by the navigation graph", () => {
  assert.deepEqual(
    publicData.settingsCategories.map(({ id }) => id),
    ["picture", "audio", "language", "subtitles", "accessibility", "network", "account", "system"],
  );
  for (const category of publicData.settingsCategories) {
    assert.ok(graph.מסכים[screenFromPath(`/settings/${category.id}`)]);
    for (const option of category.options)
      assert.ok(graph.מסכים[screenFromPath(`/settings/${category.id}/${option.id}`)]);
  }
  const contentIds = new Set(publicData.content.map(({ id }) => id));
  const appIds = new Set(publicData.apps.map(({ id }) => id));
  const programIds = new Set(publicData.programs.map(({ id }) => id));
  for (const field of ["featuredContentIds", "recommendedContentIds", "newContentIds"])
    for (const id of publicData.home[field]) assert.ok(contentIds.has(id), `${field}: ${id}`);
  for (const id of [...publicData.home.appIds, ...publicData.home.musicAppIds])
    assert.ok(appIds.has(id));
  for (const id of publicData.discovery.featuredCatchupProgramIds) assert.ok(programIds.has(id));
});

test("public catalog, navigation graph, and account seed refer to valid records", () => {
  const ids = (items, label) => {
    const values = items.map((item) => String(item.id));
    assert.equal(new Set(values).size, values.length, `${label} has duplicate IDs`);
    return new Set(values);
  };
  const content = ids(publicData.content, "content");
  const channels = ids(publicData.channels, "channels");
  const programs = ids(publicData.programs, "programs");
  ids(publicData.apps, "apps");

  for (const item of publicData.content)
    assert.equal(Object.hasOwn(item, "progress"), false, `${item.id} exposes account progress`);
  for (const program of publicData.programs)
    assert.ok(channels.has(String(program.channelId)), `${program.id} has an unknown channel`);
  for (const id of seed.library.favoriteContentIds)
    assert.ok(content.has(id), `Unknown favorite content: ${id}`);
  for (const id of seed.library.favoriteChannelIds)
    assert.ok(channels.has(id), `Unknown favorite channel: ${id}`);
  for (const item of seed.library.watchProgress)
    assert.ok(content.has(item.contentId), `Unknown progress content: ${item.contentId}`);
  for (const item of seed.library.recordings) {
    assert.ok(channels.has(item.channelId), `Unknown recording channel: ${item.channelId}`);
    assert.ok(
      content.has(item.contentId) ||
        (item.contentId.startsWith("program-") && programs.has(item.contentId.slice(8))),
      `Unknown recording content: ${item.contentId}`,
    );
  }
  for (const [screenId, screen] of Object.entries(graph.מסכים))
    for (const action of screen.פעולות || [])
      if (action.יעד) assert.ok(graph.מסכים[action.יעד], `${screenId} has an unknown destination`);
  for (const invoice of seed.billing.invoices)
    assert.equal(
      invoice.total,
      invoice.subtotal + invoice.discounts + invoice.previousBalance,
      `${invoice.id} has inconsistent totals`,
    );
});
