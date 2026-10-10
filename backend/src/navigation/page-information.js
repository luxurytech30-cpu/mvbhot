import { catalog, resolvedPrograms } from "../information/catalog-data.js";
import { pageControlsFor, screenCatalog, screenFromPath } from "./navigation-routes.js";

const ignoredWords = new Set([
  "a", "an", "the", "button", "icon", "click", "press", "select", "open",
  "in", "on", "at", "with", "that", "has", "there", "navbar", "bar",
  "כפתור", "סמל", "לחץ", "לחצו", "בחר", "בחרו", "על", "של", "את", "ב",
]);

const normalize = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase()
  .replace(/[\u0591-\u05c7]/g, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

function matchControls(controls, description) {
  const query = normalize(description);
  const words = query.split(" ").filter((word) => word.length > 1 && !ignoredWords.has(word));
  if (!words.length) return { status: "not_found", candidates: [] };
  const ranked = controls.map((control) => {
    const fields = [control.label, control.icon, control.position, control.location,
      ...(control.aliases || [])].map(normalize);
    const score = words.reduce((total, word) => {
      if (normalize(control.icon) === word) return total + 4;
      if (normalize(control.position).split(" ").includes(word)) return total + 3;
      if (fields.some((field) => field.split(" ").includes(word))) return total + 2;
      return total;
    }, 0) + (fields.includes(query) ? 5 : 0);
    return { control, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score);
  if (!ranked.length) return { status: "not_found", candidates: [] };
  const best = ranked[0];
  const rivals = ranked.filter(({ score }) => score >= best.score - 1);
  const equivalent = rivals.every(({ control }) =>
    control.targetScreen === best.control.targetScreen &&
    control.icon && control.icon === best.control.icon);
  if (rivals.length > 1 && !equivalent)
    return { status: "ambiguous", candidates: rivals.slice(0, 5).map(({ control }) => control) };
  return { status: "matched", control: best.control, candidates: [] };
}

const summary = (item, name = item.title || item.name || item.label) => ({
  id: item.id,
  name,
  ...(item.number ? { number: item.number } : {}),
  ...(item.category ? { category: item.category } : {}),
});

function recordFromPath(pathname, records) {
  const id = pathname?.split("/").filter(Boolean).at(-1);
  return records.find((item) => item.id === id);
}

function inVodCategory(item, category) {
  const tabs = catalog.categories.vod;
  return !category || category === tabs[0] || category === tabs[7] ||
    (category === tabs[1] && item.type === "movie") ||
    (category === tabs[2] && item.type === "series") ||
    (category === tabs[6] && item.year === 2026) ||
    item.category?.includes(category);
}

function pageContent(screenId, route, account) {
  const url = new URL(route || "/", "http://local");
  switch (screenId) {
    case "home":
      return {
        featuredContent: catalog.content
          .filter((item) => catalog.home.featuredContentIds.includes(item.id))
          .map((item) => summary(item)),
        recommendedContent: catalog.content
          .filter((item) => catalog.home.recommendedContentIds.includes(item.id))
          .map((item) => summary(item)),
      };
    case "vod":
    case "vod_category":
    case "vod_library": {
      const category = url.searchParams.get("category");
      const library = url.searchParams.get("library");
      return {
        categories: catalog.categories.vod || [],
        libraries: catalog.libraries.map((item) => summary(item)),
        items: catalog.content
          .filter((item) => inVodCategory(item, category))
          .filter((item) => !library || item.libraryIds.includes(library))
          .map((item) => summary(item)),
      };
    }
    case "channels":
    case "catchup":
    case "catchup_category":
      return { channels: catalog.channels.map((item) => summary(item)), categories: catalog.categories.catchup || [] };
    case "search":
      return { suggestions: catalog.discovery.searchSuggestions || [] };
    case "search_results":
      return { note: "The TV does not report the search text or the resulting items." };
    case "content_details": {
      const item = recordFromPath(url.pathname, catalog.content);
      return { item: item ? summary(item) : null };
    }
    case "channel_details":
    case "catchup_channel": {
      const item = recordFromPath(url.pathname, catalog.channels);
      return { item: item ? summary(item) : null };
    }
    case "applications":
      return { apps: catalog.apps.map((item) => summary(item)) };
    case "application_details": {
      const item = recordFromPath(url.pathname, catalog.apps);
      return { item: item ? summary(item) : null };
    }
    case "tv_guide":
      return { date: catalog.guide.date, timeSlots: catalog.guide.timeSlots,
        note: catalog.guide.note };
    case "program_details": {
      const item = recordFromPath(url.pathname, resolvedPrograms);
      return { item: item ? summary(item) : null };
    }
    case "recordings":
      return { items: (account?.library?.recordings || []).map((item) => summary(item)) };
    case "recording_details": {
      const item = recordFromPath(url.pathname, account?.library?.recordings || []);
      return { item: item ? summary(item) : null };
    }
    case "favorites":
      return {
        content: catalog.content.filter((item) =>
          account?.library?.favoriteContentIds?.includes(item.id)).map((item) => summary(item)),
        channels: catalog.channels.filter((item) =>
          account?.library?.favoriteChannelIds?.includes(item.id)).map((item) => summary(item)),
      };
    case "settings":
      return { categories: catalog.settingsCategories.map((item) => summary(item)) };
    case "service":
    case "packages":
      return { plans: catalog.plans.map((item) => ({ id: item.id || item.planId, name: item.name || item.planName })) };
    case "vod_libraries":
      return { libraries: catalog.libraries.map((item) => summary(item)) };
    case "bills":
    case "bill_details":
    case "invoice_view":
    case "account":
      return { note: "Use get_account_information for current personal values." };
    default:
      if (screenId.startsWith("settings_")) {
        const group = catalog.settingsCategories.find((item) =>
          url.pathname.startsWith(`/settings/${item.id}`),
        );
        return group ? {
          group: summary(group),
          options: (group.options || []).map((item) => ({ ...summary(item), values: item.values || [] })),
        } : {};
      }
      return {};
  }
}

export function pageInformation({ screenId, route, account, uiState, reported, controlDescription }) {
  const page = screenCatalog.find((item) => item.id === screenId);
  if (!page) throw new Error("Unknown destination");
  let activeScreen = screenId;
  if (uiState?.dialog === "notifications") activeScreen = "notifications_dialog";
  else if (uiState?.menuOpen) activeScreen = "side_menu";
  const activePage = screenCatalog.find((item) => item.id === activeScreen);
  const resolvedRoute = route && screenFromPath(route) === screenId ? route : null;
  const controls = pageControlsFor(activeScreen, account);
  const controlMatch = controlDescription
    ? matchControls(controls, controlDescription)
    : null;
  return {
    screenId: activeScreen,
    name: activePage.name,
    description: activePage.description,
    reported: Boolean(reported),
    controls: controlMatch?.status === "matched" ? [controlMatch.control] : controls,
    controlMatch,
    content: activeScreen === screenId ? pageContent(screenId, resolvedRoute, account) : {},
    note: "Controls are documented for this page. The TV reports the route and open menu/dialog, not focus, search text, or every completed action. Account details require the account tool.",
  };
}

const itemCollections = {
  content: catalog.content,
  channel: catalog.channels,
  program: resolvedPrograms,
  app: catalog.apps,
  library: catalog.libraries,
};

export function requestedCatalogItem(kind, id) {
  const collection = itemCollections[kind];
  const item = collection?.find((record) => record.id === id);
  if (!item) throw new Error("Unknown access target");
  return { kind, ...summary(item) };
}
