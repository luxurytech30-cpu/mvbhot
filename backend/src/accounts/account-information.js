import { publicInformationForCategory } from "../information/public-catalog.js";

const categoryDescriptions = {
  purchases:
    "Actual monthly channel/library subscriptions, one-time rentals/events, prices, cancellations, expiry and playback usage",
  access:
    "Current per-account content, channel, library and CatchUp access, with purchase options for locked items",
  profile: "The user's name, gender, contact details, and customer number",
  subscription: "The user's current plan, status, monthly price, included categories, and add-ons",
  preferences:
    "The user's selected language, subtitles, audio, video, playback, accessibility, and sound preferences",
  library: "The user's favorites, watch progress, and recordings",
  billing: "The user's payment method, invoices, charges, balances, and payment status",
  notifications: "Notifications addressed to the user",
};

export const accountCategoryCatalog = Object.keys(categoryDescriptions).map((id) => ({
  id,
  description: categoryDescriptions[id],
}));

export function accountInformationForCategory(category, user) {
  if (!Object.hasOwn(categoryDescriptions, category)) return null;
  return user[category] ?? null;
}

const contentById = new Map(
  publicInformationForCategory("content").map((item) => [item.id, item.title]),
);
const channelById = new Map(
  publicInformationForCategory("channels").map((item) => [item.id, item.name]),
);
export function accountPublicLabels(category, information) {
  if (category !== "library") return null;

  const library = information;
  const contentIds = new Set([
    ...(library.favoriteContentIds || []),
    ...(library.watchProgress || []).map((item) => item.contentId),
    ...(library.recordings || []).map((item) => item.contentId),
  ]);
  const channelIds = new Set([
    ...(library.favoriteChannelIds || []),
    ...(library.recordings || []).map((item) => item.channelId),
  ]);

  return {
    contentTitles: Object.fromEntries(
      [...contentIds].filter((id) => contentById.has(id)).map((id) => [id, contentById.get(id)]),
    ),
    channelNames: Object.fromEntries(
      [...channelIds].filter((id) => channelById.has(id)).map((id) => [id, channelById.get(id)]),
    ),
  };
}
