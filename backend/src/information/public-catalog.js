import { publicTVData } from "./catalog-data.js";

const data = publicTVData();

const categoryDescriptions = {
  libraries: "VOD libraries and canonical content IDs; check account access separately",
  offers: "Optional channel/library monthly purchases and one-time title/event prices",
  plans: "Plans with exact included channel IDs and VOD library IDs",
  accessPolicy: "Universal access, cancellation rules and prorated demo billing",
  site: "NOVA TV identity and language",
  content: "Movies and series, titles, descriptions, genres, and availability in the catalog",
  channels:
    "TV channels, channel numbers, and sample current or next program labels from the demo snapshot, not a live schedule",
  programs:
    "Sample TV programs and their dated details from the demo snapshot, not a live schedule",
  apps: "Available apps and their descriptions",
  categories: "VOD and CatchUp browsing categories",
  guide: "Sample TV guide time slots from the demo snapshot, not a live schedule",
  home: "Featured, recommended, new, and live content on the home screen",
  discovery: "Featured CatchUp programs and search suggestions",
  service: "Support, packages, plans, and VOD libraries",
  settingsCategories: "Picture, audio, language, subtitles, and accessibility settings",
  playback: "Player behavior, subtitles, audio languages, quality, speed and progress saving",
  accountFeatures:
    "Login, account features, favorites, recordings, storage and limitations; no personal values",
};

const informationCategoryIds = Object.keys(data).filter(
  (id) => id !== "schemaVersion" && id !== "assets",
);

export const publicCategoryCatalog = informationCategoryIds.map((id) => ({
  id,
  description: categoryDescriptions[id] || id,
}));

export function publicInformationForCategory(category) {
  return informationCategoryIds.includes(category) ? data[category] : null;
}
