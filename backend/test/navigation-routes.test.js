import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildNavigationRoute, screenFromPath } from "../src/navigation/navigation-routes.js";

const graph = JSON.parse(
  fs.readFileSync(new URL("../src/navigation/navigation-graph.json", import.meta.url), "utf8"),
);

test("the graph has only valid fixed destinations", () => {
  const actions = [
    ...graph.פעולות_גלובליות,
    ...Object.values(graph.מסכים).flatMap((screen) => screen.פעולות || []),
  ];
  for (const action of actions) {
    if (action.יעד)
      assert.ok(graph.מסכים[action.יעד], `${action.פעולה} has an unknown destination`);
  }
});

test("every navigable screen is reachable from home", () => {
  for (const screenId of Object.keys(graph.מסכים)) {
    if (screenId === "not_found") continue;
    const route = buildNavigationRoute({
      imageName: "home.png",
      targetScreen: screenId,
      userIntent: screenId,
    });
    assert.equal(route.success, true, `${screenId} is not reachable from home`);
  }
});

test("navigation gives the location before the action", () => {
  const route = buildNavigationRoute({
    imageName: "home.png",
    targetScreen: "settings",
    userIntent: "הגדרות",
  });
  assert.equal(route.success, true);
  assert.equal(route.steps[0].action, "OPEN_SETTINGS");
  assert.match(route.steps[0].location, /גלגל השיניים/);
  assert.doesNotMatch(route.steps[0].instruction, /גלגל השיניים/);
  assert.equal(route.steps[0].expectedResult, "הגדרות");
  assert.match(route.finalInstruction, /גלגל השיניים/);
  assert.doesNotMatch(route.finalInstruction, /התוצאה הצפויה|כפתור גלגל השיניים:/);
});

test("navigation uses ordered substeps", () => {
  const route = buildNavigationRoute({
    imageName: "home.png",
    targetScreen: "recordings",
    userIntent: "הקלטות",
  });
  assert.equal(route.success, true);
  assert.equal(route.steps[0].action, "OPEN_RECORDINGS");
  assert.match(route.steps[0].instruction, /פתחו את התפריט.*לאחר מכן.*הקלטות/);
});

test("player routes cannot use a regular screen's top bar", () => {
  const route = buildNavigationRoute({
    imageName: "vod_player.png",
    targetScreen: "settings",
    userIntent: "הגדרות",
  });
  assert.equal(route.success, true);
  assert.equal(route.steps[0].action, "HOME");
  assert.ok(
    route.steps.every(
      (step) => step.action !== "TOP_SETTINGS" && step.action !== "RAIL_SELECT_SETTINGS",
    ),
  );
});

test("invoice navigation from the account page includes details before the popup", () => {
  const route = buildNavigationRoute({
    imageName: "account.png",
    targetScreen: "invoice_view",
    userIntent: "Show my invoice",
  });
  assert.deepEqual(
    route.steps.map(({ toScreen }) => toScreen),
    ["bill_details", "invoice_view"],
  );
});

test("closing subtitles never requires changing the selected language", () => {
  const route = buildNavigationRoute({
    imageName: "subtitles.png",
    targetScreen: "audio_options",
    userIntent: "Open audio",
  });
  assert.deepEqual(
    route.steps.map(({ action }) => action),
    ["CLOSE_SUBTITLES", "OPEN_AUDIO"],
  );
});

test("direct and nested audio popups close to the correct destination", () => {
  const direct = screenFromPath("/player/horizon?panel=audio");
  const nested = screenFromPath("/player/horizon?panel=audio&from=settings");
  assert.equal(direct, "audio_options");
  assert.equal(nested, "audio_options_from_settings");
  const route = buildNavigationRoute({
    imageName: `${nested}.png`,
    targetScreen: "video_options",
    userIntent: "Open picture quality",
  });
  assert.deepEqual(
    route.steps.map(({ toScreen }) => toScreen),
    ["player_settings", "video_options"],
  );
});

test("URL recognition does not infer a selected preference or search results", () => {
  assert.equal(screenFromPath("/player/live-music"), "vod_player");
  assert.equal(screenFromPath("/player/live-12"), "live_player");
  assert.equal(screenFromPath("/search"), "search");
  assert.equal(screenFromPath("/settings/language"), "settings_language");
  assert.equal(screenFromPath("/player/horizon?panel=subtitles"), "subtitles");
  assert.equal(screenFromPath("/vod?category=" + encodeURIComponent("הכל")), "vod");
  assert.equal(screenFromPath("/catchup?category=" + encodeURIComponent("הכל")), "catchup");
  for (const state of [
    "search_results",
    "subtitles_hebrew",
    "subtitles_english",
    "subtitles_off",
    "settings_language_hebrew",
    "settings_language_english",
    "recording_player",
  ])
    assert.equal(graph.מסכים[state].נתיב, null);
});

test("empty account lists do not produce instructions to select nonexistent items", () => {
  const account = {
    library: { favoriteContentIds: [], favoriteChannelIds: [], watchProgress: [], recordings: [] },
    billing: { invoices: [] },
  };
  const content = buildNavigationRoute({
    imageName: "favorites.png",
    targetScreen: "content_details",
    account,
  });
  assert.equal(content.success, true);
  assert.ok(content.steps.every(({ action }) => action !== "SELECT_FAVORITE_CONTENT"));
  for (const targetScreen of ["recording_details", "bill_details", "invoice_view"]) {
    const route = buildNavigationRoute({ imageName: "account.png", targetScreen, account });
    assert.equal(route.success, false, targetScreen);
  }
  const current = buildNavigationRoute({
    imageName: "account.png",
    targetScreen: "account",
    account,
  });
  assert.ok(
    current.destinationOptions.every(
      ({ action }) =>
        !["OPEN_CONTENT", "OPEN_CHANNEL", "OPEN_RECORDING", "OPEN_INVOICE"].includes(action),
    ),
  );
});
