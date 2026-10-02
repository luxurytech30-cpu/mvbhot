import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(fs.readFileSync(path.join(directory, "graph.json"), "utf8"));
const screens = graph.מסכים;
const globalActions = graph.פעולות_גלובליות;
const imageScreenAliases = { apps: "applications" };
function availableGlobalActions(screenId) {
  const screen = screens[screenId];
  const isDialog = screen.סוג === "חלונית" || screenId === "side_menu";
  const isPlayer = screen.נתיב?.startsWith("/player/") || screen.סוג === "מצב נגן";
  const isRegularScreen = Boolean(screen.נתיב) && !isPlayer && !isDialog && screen.סוג !== "חריג";

  return globalActions.filter(action => {
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
function findShortestPath(start, target) {
  const queue = [{ screen: start, path: [] }];
  const visited = new Set([start]);

  for (let index = 0; index < queue.length; index += 1) {
    const { screen, path: route } = queue[index];
    if (screen === target) return route;

    const actions = [...(screens[screen].פעולות || []), ...availableGlobalActions(screen)];
    for (const action of actions) {
      const next = action.יעד;
      if (!screens[next] || visited.has(next)) continue;
      visited.add(next);
      queue.push({ screen: next, path: [...route, { from: screen, to: next, action }] });
    }
  }
  return null;
}

export function buildNavigationRoute({ imageName, targetScreen, userIntent }) {
  const currentScreen = screenFromImageName(imageName);
  const destination = screens[targetScreen] ? targetScreen : null;
  const path = destination ? findShortestPath(currentScreen, destination) : null;
  const steps = path?.map(({ from, to, action }, index) => ({
    step: index + 1,
    fromScreen: from,
    action: action.פעולה,
    location: action.מיקום || null,
    instructions: action.שלבים || [action.הוראה],
    instruction: actionInstruction(action),
    expectedResult: action.תוצאה || screens[to].שם,
    toScreen: to,
  })) || [];
  const finalInstruction = path
    ? steps.length
      ? `כדי להגיע אל ${screens[destination].שם}, ${steps.map(step => `${step.location ? `חפשו את ${step.location}. ` : ""}${step.instruction}`).join(" ")}`
      : `אתה כבר נמצא במסך ${screens[currentScreen].שם}.`
    : "לא מצאתי בגרף הניווט מסלול ליעד המבוקש.";

  return {
    currentScreen,
    currentScreenReason: `שם הקובץ ${imageName} תואם למסך ${screens[currentScreen].שם}.`,
    userIntent,
    targetScreen: destination,
    targetScreenName: destination ? screens[destination].שם : null,
    targetScreenDescription: destination ? screens[destination].תיאור : null,
    destinationOptions: destination ? (screens[destination].פעולות || []).map(action => ({
      action: action.פעולה,
      instruction: actionInstruction(action),
      targetScreen: action.יעד,
    })) : [],
    steps,
    finalInstruction,
    success: Boolean(path),
  };
}
