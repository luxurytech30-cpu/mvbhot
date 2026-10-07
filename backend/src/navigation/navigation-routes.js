import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(fs.readFileSync(path.join(directory, "navigation-graph.json"), "utf8"));
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

function actionInstruction(action) {
  return action.שלבים?.length ? action.שלבים.join(" לאחר מכן, ") : action.הוראה;
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

export function buildNavigationRoute({ imageName, targetScreen, userIntent, account }) {
  const currentScreen = screenFromImageName(imageName);
  const destination = screens[targetScreen] ? targetScreen : null;
  const path = destination ? findShortestPath(currentScreen, destination, account) : null;
  const steps =
    path?.map(({ from, to, action }, index) => ({
      step: index + 1,
      fromScreen: from,
      action: action.פעולה,
      location: action.מיקום || null,
      instructions: action.שלבים || [action.הוראה],
      instruction: actionInstruction(action),
      condition: action.תנאי || null,
      expectedResult: action.תוצאה || screens[to].שם,
      toScreen: to,
    })) || [];
  const finalInstruction = path
    ? steps.length
      ? `כדי להגיע אל ${screens[destination].שם}, ${steps.map((step) => `${step.location ? `חפשו את ${step.location}. ` : ""}${step.instruction}`).join(" ")}`
      : `אתה כבר נמצא במסך ${screens[currentScreen].שם}.`
    : "לא מצאתי בגרף הניווט מסלול ליעד המבוקש.";

  return {
    currentScreen,
    currentScreenReason: `שם הקובץ ${imageName} תואם למסך ${screens[currentScreen].שם}.`,
    userIntent,
    targetScreen: destination,
    targetScreenName: destination ? screens[destination].שם : null,
    targetScreenDescription: destination ? screens[destination].תיאור : null,
    contextLimitations: graph.מערכת.מגבלות_הקשר,
    destinationOptions: destination
      ? (screens[destination].פעולות || [])
          .filter((action) => actionAvailable(action, account))
          .map((action) => ({
            action: action.פעולה,
            location: action.מיקום || null,
            instruction: actionInstruction(action),
            choices: action.אפשרויות,
            condition: action.תנאי,
            targetScreen: action.יעד,
            expectedResult: action.תוצאה,
          }))
      : [],
    steps,
    finalInstruction,
    success: Boolean(path),
  };
}
