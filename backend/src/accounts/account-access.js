import { catalog, contentById, programById, offerById } from "../information/catalog-data.js";

export function purchaseActive(purchase, now) {
  if (purchase.status === "cancelled" && purchase.billing !== "monthly") return false;
  return !purchase.expiresAt || new Date(purchase.expiresAt) > now;
}
function entitlementState(user, now) {
  const planActive = !user.subscription.cancelAt || new Date(user.subscription.cancelAt) > now;
  const purchases = user.purchases.items.filter((item) => purchaseActive(item, now));
  const offers = purchases.map((purchase) => offerById.get(purchase.offerId)).filter(Boolean);
  const channelIds = new Set([
    ...catalog.accessPolicy.baseChannelIds,
    ...(planActive ? user.subscription.channelIds : []),
    ...offers.flatMap((offer) => offer.channelIds),
  ]);
  const libraryIds = new Set([
    ...catalog.accessPolicy.baseLibraryIds,
    ...(planActive ? user.subscription.libraryIds : []),
    ...offers.flatMap((offer) => offer.libraryIds),
  ]);
  const boughtContent = new Set(offers.flatMap((offer) => offer.contentIds));
  return { channelIds, libraryIds, boughtContent, offers };
}
export function accessFor(user, kind, id, now = new Date(), state = entitlementState(user, now)) {
  const { channelIds, libraryIds, boughtContent, offers } = state;
  let allowed = false,
    reason = "locked",
    title,
    targetContent;
  if (kind === "channel") {
    const channel = catalog.channels.find((item) => item.id === id);
    if (!channel) throw Object.assign(new Error("Unknown channel"), { status: 400 });
    allowed = channelIds.has(id);
    title = channel.name;
  } else if (kind === "library") {
    const library = catalog.libraries.find((item) => item.id === id);
    if (!library) throw Object.assign(new Error("Unknown VOD library"), { status: 400 });
    allowed = libraryIds.has(id);
    title = library.name;
  } else if (kind === "content") {
    targetContent = contentById.get(id);
    if (!targetContent) throw Object.assign(new Error("Unknown content"), { status: 400 });
    title = targetContent.title;
    allowed =
      boughtContent.has(id) ||
      (targetContent.vod && targetContent.libraryIds.some((key) => libraryIds.has(key)));
  } else if (kind === "program") {
    const program = programById.get(id);
    if (!program) throw Object.assign(new Error("Unknown program"), { status: 400 });
    targetContent = contentById.get(program.contentId);
    title = targetContent.title;
    allowed =
      channelIds.has(program.channelId) ||
      boughtContent.has(program.contentId) ||
      (targetContent.vod && targetContent.libraryIds.some((key) => libraryIds.has(key)));
    const [day, month, year] = (program.endDate || program.date).split(".").map(Number);
    const [hour, minute] = program.end.split(":").map(Number);
    const availableUntil = new Date(Date.UTC(year, month - 1, day + program.catchupDays, hour, minute));
    const recorded = user.library.recordings.some(
      (recording) => recording.contentId === `program-${id}`,
    );
    if (!recorded && now >= availableUntil)
      return { id, title, allowed: false, reason: "catchup_expired", purchaseOptions: [] };
  } else throw Object.assign(new Error("Invalid access type"), { status: 400 });
  if (allowed) reason = "included_or_purchased";
  const purchaseOptions = allowed
    ? []
    : catalog.offers.filter((offer) => {
        if (kind === "channel") {
          const channel = catalog.channels.find((item) => item.id === id);
          const currentContentId = programById.get(channel.currentProgramId).contentId;
          return (
            offer.channelIds.includes(id) ||
            (offer.kind === "event" &&
              offer.contentIds.includes(currentContentId) &&
              !boughtContent.has(currentContentId))
          );
        }
        if (kind === "library") return offer.libraryIds.includes(id);
        if (kind === "program") {
          const program = programById.get(id);
          return (
            offer.channelIds.includes(program.channelId) ||
            offer.contentIds.includes(program.contentId) ||
            offer.libraryIds.some((key) => targetContent.libraryIds.includes(key))
          );
        }
        return (
          offer.contentIds.includes(id) ||
          offer.libraryIds.some((key) => targetContent.libraryIds.includes(key))
        );
      });
  const currentEvent =
    kind === "channel"
      ? (() => {
          const channel = catalog.channels.find((item) => item.id === id);
          const program = programById.get(channel.currentProgramId);
          return {
            programId: program.id,
            contentId: program.contentId,
            title: contentById.get(program.contentId).title,
            allowed:
              allowed ||
              offers.some(
                (offer) => offer.kind === "event" && offer.contentIds.includes(program.contentId),
              ),
          };
        })()
      : undefined;
  return {
    id,
    title,
    allowed: Boolean(allowed),
    reason,
    purchaseOptions,
    ...(currentEvent ? { currentEvent } : {}),
  };
}
export function accountAccess(user, now) {
  const state = entitlementState(user, now);
  return {
    channels: catalog.channels.map((item) => accessFor(user, "channel", item.id, now, state)),
    content: catalog.content
      .filter((item) => item.vod)
      .map((item) => accessFor(user, "content", item.id, now, state)),
    programs: catalog.programs.map((item) => accessFor(user, "program", item.id, now, state)),
    libraries: catalog.libraries.map((item) => accessFor(user, "library", item.id, now, state)),
  };
}
