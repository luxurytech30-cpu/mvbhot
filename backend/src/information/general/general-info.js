import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(directory, "data_general_info.json"), "utf8"));

const categoryDescriptions = {
  site: "NOVA TV identity and demo language",
  content: "Movies and series, titles, descriptions, genres, and availability in the demo catalog",
  channels: "TV channels, channel numbers, and current or next program labels",
  programs: "TV programs and their details",
  apps: "Available apps and their descriptions",
  categories: "VOD and CatchUp browsing categories",
  guide: "TV guide time slots",
  home: "Featured, recommended, new, and live content on the home screen",
  discovery: "Featured CatchUp programs and search suggestions",
  service: "Support, packages, plans, and VOD libraries",
  settingsCategories: "Picture, audio, language, subtitles, and accessibility settings",
  navigation: "Main menu sections and their paths",
  navigationGraph: "Detailed interface pages and their relationships",
};

const informationCategoryIds = Object.keys(data).filter(id => id !== "schemaVersion" && id !== "assets");

export const informationCategoryCatalog = informationCategoryIds
  .map(id => ({ id, description: categoryDescriptions[id] || id }));

export function informationForCategory(category) {
  return informationCategoryIds.includes(category)
    ? data[category]
    : null;
}
