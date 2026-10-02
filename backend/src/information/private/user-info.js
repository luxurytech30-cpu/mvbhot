import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { informationForCategory } from "../general/general-info.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(directory, "user-info.json"), "utf8"));
const user = data.user;

const categoryDescriptions = {
  profile: "The user's name, contact details, and customer number",
  subscription: "The user's current plan, status, monthly price, included categories, and add-ons",
  preferences: "The user's selected language, subtitles, audio, video, playback, accessibility, and sound preferences",
  library: "The user's favorites, watch progress, and recordings",
  billing: "The user's payment method, invoices, charges, balances, and payment status",
  notifications: "Notifications addressed to the user",
};

export const userInformationCategoryCatalog = Object.keys(categoryDescriptions).map(id => ({
  id,
  description: categoryDescriptions[id],
}));

export function userInformationForCategory(category) {
  if (!Object.hasOwn(categoryDescriptions, category)) return null;
  return user[category] ?? null;
}

export function publicLabelsForUserCategory(category) {
  if (category !== "library") return null;

  const library = user.library;
  const contentById = new Map(informationForCategory("content").map(item => [item.id, item.title]));
  const channelById = new Map(informationForCategory("channels").map(item => [item.id, item.name]));
  const contentIds = new Set([
    ...(library.favoriteContentIds || []),
    ...(library.watchProgress || []).map(item => item.contentId),
    ...(library.recordings || []).map(item => item.contentId),
  ]);
  const channelIds = new Set([
    ...(library.favoriteChannelIds || []),
    ...(library.recordings || []).map(item => item.channelId),
  ]);

  return {
    contentTitles: Object.fromEntries([...contentIds].filter(id => contentById.has(id)).map(id => [id, contentById.get(id)])),
    channelNames: Object.fromEntries([...channelIds].filter(id => channelById.has(id)).map(id => [id, channelById.get(id)])),
  };
}
