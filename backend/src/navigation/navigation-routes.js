import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(fs.readFileSync(path.join(directory, "navigation-graph.json"), "utf8"));
const pageControls = JSON.parse(fs.readFileSync(path.join(directory, "page-controls.json"), "utf8"));
const screens = graph.מסכים;
const globalActions = graph.פעולות_גלובליות;
const imageScreenAliases = { apps: "applications" };
// Match the actual TV route, preferring query/prefix specificity over generic players.
export function screenFromPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 1000)
    throw new Error("Invalid TV route");
  const current = new URL(value, "http://local");
  const candidates = Object.entries(screens)
    .flatMap(([id, screen]) =>
      [screen.נתיב, ...(screen.נתיבים_חלופיים || [])]
        .filter(Boolean)
        .map((route) => ({ id, route })),
    )
    .sort(
      (a, b) =>
        b.route.replace(/:[A-Za-z]+/g, "").length - a.route.replace(/:[A-Za-z]+/g, "").length,
    );
  for (const { id, route } of candidates) {
    const [path, query = ""] = route.split("?");
    const pattern = path
      .split(/(:[A-Za-z]+)/)
      .map((part) => (part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("");
    if (!new RegExp(`^${pattern}$`).test(current.pathname)) continue;
    if (
      [...new URLSearchParams(query)].every(([key, value]) =>
        value.startsWith(":")
          ? current.searchParams.has(key)
          : current.searchParams.get(key) === value,
      )
    )
      return id;
  }
  throw new Error("Unknown TV route");
}
function availableGlobalActions(screenId) {
  const screen = screens[screenId];
  if (screen.סוג === "אימות") return [];
  const isDialog = screen.סוג === "חלונית" || screenId === "side_menu";
  const isPlayer = screen.נתיב?.startsWith("/player/") || screen.סוג === "מצב נגן";
  const isRegularScreen = Boolean(screen.נתיב) && !isPlayer && !isDialog && screen.סוג !== "חריג";

  return globalActions.filter((action) => {
    switch (action.מקור) {
      case undefined:
        return true;
      case "כל מסך, כולל הנגן וחלונית פתוחה":
      case "כל מסך":
        return true;
      case "כל מסך ללא חלונית פעילה":
        return !isDialog;
      case "כל מסך רגיל שאינו נגן או חלונית":
        return isRegularScreen;
      default:
        return false;
    }
  });
}

const F = {
  system: "\u05de\u05e2\u05e8\u05db\u05ea",
  id: "\u05e4\u05e2\u05d5\u05dc\u05d4",
  target: "\u05d9\u05e2\u05d3",
  name: "\u05e9\u05dd",
  description: "\u05ea\u05d9\u05d0\u05d5\u05e8",
  actions: "\u05e4\u05e2\u05d5\u05dc\u05d5\u05ea",
  contextLimitations: "\u05de\u05d2\u05d1\u05dc\u05d5\u05ea_\u05d4\u05e7\u05e9\u05e8",
};

function controlFor(screenId, actionId, isGlobal = false) {
  const controls = isGlobal ? pageControls.global : pageControls.screens[screenId] || [];
  const control = controls.find((item) => item.id === actionId);
  if (!control) throw new Error(`Missing page control: ${screenId}/${actionId}`);
  return control;
}

function detailedControl(screenId, action, isGlobal = false) {
  const targetScreen = action[F.target] || null;
  const control = {
    ...controlFor(screenId, action[F.id], isGlobal),
    targetScreen,
    targetName: screens[targetScreen]?.[F.name] || null,
  };
  // Some legacy graph edges combine opening the menu with selecting its item.
  // Expose the two actual controls without adding written instructions to the graph.
  const menuItem = (screens.side_menu[F.actions] || []).find(
    (item) => item[F.target] === targetScreen,
  );
  if (!isGlobal && screenId !== "side_menu" && menuItem &&
      control.location?.includes("\u05ea\u05e4\u05e8\u05d9\u05d8")) {
    control.sequence = [
      { ...controlFor(screenId, "OPEN_MENU", true), targetScreen: "side_menu" },
      { ...controlFor("side_menu", menuItem[F.id]), targetScreen,
        targetName: screens[targetScreen]?.[F.name] || null },
    ];
  }
  return control;
}

export function pageControlsFor(screenId, account) {
  if (!screens[screenId]) throw new Error("Unknown destination");
  const local = (screens[screenId][F.actions] || [])
    .filter((action) => actionAvailable(action, account))
    .map((action) => detailedControl(screenId, action));
  const common = availableGlobalActions(screenId)
    .filter((action) => actionAvailable(action, account))
    .map((action) => detailedControl(screenId, action, true));
  return [...local, ...common];
}

function actionInstruction(control) {
  return control.sequence?.map((item) => item.location || item.id).join(" → ") ||
    control.location || control.id;
}

export const screenCatalog = Object.entries(screens).map(([id, screen]) => ({
  id,
  name: screen.שם,
  description: screen.תיאור,
}));

export function screenFromImageName(imageName) {
  const name = path.parse(path.basename(imageName)).name.toLowerCase();
  const screenId = imageScreenAliases[name] || name;
  if (!screens[screenId]) throw new Error(`Unknown screen image name: ${imageName}`);
  return screenId;
}

// Breadth-first search keeps the existing rule: use the first shortest route.
function actionAvailable(action, account) {
  if (!account || !action.requiresAccountRecords) return true;
  return action.requiresAccountRecords.some((field) => {
    const records = field.split(".").reduce((value, key) => value?.[key], account);
    return Array.isArray(records) && records.length > 0;
  });
}

function findShortestPath(start, target, account) {
  const queue = [{ screen: start, path: [] }];
  const visited = new Set([start]);

  for (let index = 0; index < queue.length; index += 1) {
    const { screen, path: route } = queue[index];
    if (screen === target) return route;

    const actions = [...(screens[screen].פעולות || []), ...availableGlobalActions(screen)];
    for (const action of actions) {
      if (!actionAvailable(action, account)) continue;
      const next = action.יעד;
      if (!screens[next] || visited.has(next)) continue;
      visited.add(next);
      queue.push({
        screen: next,
        path: [...route, { from: screen, to: next, action }],
      });
    }
  }
  return null;
}

export function buildNavigationRoute({ imageName, targetScreen, viaScreen, userIntent, account, uiState }) {
  const currentScreen = uiState?.dialog === "notifications"
    ? "notifications_dialog"
    : uiState?.menuOpen
      ? "side_menu"
      : screenFromImageName(imageName);
  const destination = screens[targetScreen] ? targetScreen : null;
  const firstLeg = viaScreen ? findShortestPath(currentScreen, viaScreen, account) : [];
  const secondLeg = destination && firstLeg
    ? findShortestPath(viaScreen || currentScreen, destination, account)
    : null;
  const route = secondLeg ? [...firstLeg, ...secondLeg] : null;
  const steps = route?.map(({ from, to, action }, index) => {
    const isGlobal = globalActions.includes(action);
    const control = detailedControl(from, action, isGlobal);
    return {
      step: index + 1,
      fromScreen: from,
      action: action[F.id],
      control,
      location: control.location || null,
      instructions: [actionInstruction(control)],
      instruction: actionInstruction(control),
      condition: control.condition || null,
      expectedResult: control.expectedResult || screens[to][F.name],
      toScreen: to,
    };
  }) || [];
  const destinationOptions = destination
    ? pageControlsFor(destination, account).map((control) => ({
        action: control.id,
        control,
        location: control.location || null,
        choices: control.choices,
        condition: control.condition,
        targetScreen: control.targetScreen,
        expectedResult: control.expectedResult,
      }))
    : [];
  return {
    currentScreen,
    userIntent,
    targetScreen: destination,
    targetScreenName: destination ? screens[destination][F.name] : null,
    targetScreenDescription: destination ? screens[destination][F.description] : null,
    contextLimitations: graph[F.system][F.contextLimitations],
    destinationOptions,
    steps,
    finalInstruction: route ? steps.map((step) => step.instruction).join(". ") : "",
    success: Boolean(route),
  };
}
