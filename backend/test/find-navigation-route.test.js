import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildNavigationRoute } from "../src/navigation/find-navigation-route.js";

const graph = JSON.parse(fs.readFileSync(new URL("../src/navigation/graph.json", import.meta.url), "utf8"));

test("the graph has only valid fixed destinations", () => {
  const actions = [
    ...graph.פעולות_גלובליות,
    ...Object.values(graph.מסכים).flatMap(screen => screen.פעולות || []),
  ];
  for (const action of actions) {
    if (action.יעד) assert.ok(graph.מסכים[action.יעד], `${action.פעולה} has an unknown destination`);
  }
});

test("every navigable screen is reachable from home", () => {
  for (const screenId of Object.keys(graph.מסכים)) {
    if (screenId === "not_found") continue;
    const route = buildNavigationRoute({ imageName: "home.png", targetScreen: screenId, userIntent: screenId });
    assert.equal(route.success, true, `${screenId} is not reachable from home`);
  }
});

test("navigation gives the location before the action", () => {
  const route = buildNavigationRoute({ imageName: "home.png", targetScreen: "settings", userIntent: "הגדרות" });
  assert.equal(route.success, true);
  assert.equal(route.steps[0].action, "OPEN_SETTINGS");
  assert.match(route.steps[0].location, /גלגל השיניים/);
  assert.doesNotMatch(route.steps[0].instruction, /גלגל השיניים/);
  assert.equal(route.steps[0].expectedResult, "הגדרות");
  assert.match(route.finalInstruction, /גלגל השיניים/);
  assert.doesNotMatch(route.finalInstruction, /התוצאה הצפויה|כפתור גלגל השיניים:/);
});

test("navigation uses ordered substeps", () => {
  const route = buildNavigationRoute({ imageName: "home.png", targetScreen: "recordings", userIntent: "הקלטות" });
  assert.equal(route.success, true);
  assert.equal(route.steps[0].action, "OPEN_RECORDINGS");
  assert.match(route.steps[0].instruction, /פתחו את התפריט.*לאחר מכן.*הקלטות/);
});

test("player routes cannot use a regular screen's top bar", () => {
  const route = buildNavigationRoute({ imageName: "vod_player.png", targetScreen: "settings", userIntent: "הגדרות" });
  assert.equal(route.success, true);
  assert.equal(route.steps[0].action, "HOME");
  assert.ok(route.steps.every(step => step.action !== "TOP_SETTINGS" && step.action !== "RAIL_SELECT_SETTINGS"));
});
