import { publicInformationForCategory } from "../information/public-catalog.js";
import { applyCommerceChange } from "./account-commerce.js";
import { accessFor } from "./account-access.js";

const contentIds = new Set(publicInformationForCategory("content").map((item) => item.id));
const channelIds = new Set(publicInformationForCategory("channels").map((item) => item.id));
const programs = new Map(publicInformationForCategory("programs").map((item) => [item.id, item]));
const preferenceValues = new Map(
  publicInformationForCategory("settingsCategories")
    .flatMap((category) => category.options || [])
    .filter((option) => option.preference && option.values)
    .map((option) => [option.preference, new Set(option.values)]),
);
const bad = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};

export function applyAccountChange(user, change, now = new Date()) {
  if (!change || typeof change !== "object") bad("Invalid account change");
  const { operation, id, key, value } = change;
  if (applyCommerceChange(user, change, now)) return user;
  if (operation === "favorite") {
    if (!["content", "channel"].includes(change.kind)) bad("Invalid favorite type");
    if (!(change.kind === "channel" ? channelIds : contentIds).has(id)) bad("Unknown favorite");
    const field = change.kind === "channel" ? "favoriteChannelIds" : "favoriteContentIds";
    user.library[field] = user.library[field].includes(id)
      ? user.library[field].filter((item) => item !== id)
      : [...user.library[field], id];
  } else if (operation === "preference") {
    if (!Object.hasOwn(user.preferences, key) || !preferenceValues.get(key)?.has(value))
      bad("Invalid preference");
    user.preferences[key] = value;
  } else if (operation === "progress") {
    if (!contentIds.has(id) || typeof value !== "number" || !Number.isFinite(value))
      bad("Invalid watch progress");
    if (!accessFor(user, "content", id, now).allowed) bad("This content is locked");
    user.library.watchProgress = [
      ...user.library.watchProgress.filter((item) => item.contentId !== id),
      {
        contentId: id,
        percent: Math.round(Math.max(0, Math.min(100, value))),
      },
    ];
  } else if (operation === "recording") {
    const recording = change.recording;
    const program = recording?.contentId?.startsWith("program-")
      ? programs.get(recording.contentId.slice(8))
      : null;
    if (
      !recording ||
      !(contentIds.has(recording.contentId) || program?.channelId === recording.channelId) ||
      !channelIds.has(recording.channelId) ||
      ["id", "title", "date"].some(
        (field) => typeof recording[field] !== "string" || recording[field].length > 200,
      ) ||
      !Number.isFinite(recording.duration) ||
      recording.duration < 0 ||
      recording.duration > 1440
    )
      bad("Invalid recording");
    const access = program
      ? accessFor(user, "program", program.id, now)
      : accessFor(user, "content", recording.contentId, now);
    if (!access.allowed) bad("This program is locked");
    if (user.library.recordings.length >= 200) bad("Recording limit reached");
    if (!user.library.recordings.some((item) => item.id === recording.id))
      user.library.recordings.push(
        Object.fromEntries(
          ["id", "contentId", "channelId", "title", "date", "duration"].map((field) => [
            field,
            recording[field],
          ]),
        ),
      );
  } else bad("Unknown account operation");
  return user;
}
