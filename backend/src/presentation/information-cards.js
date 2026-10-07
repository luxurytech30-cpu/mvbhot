import { accountPublicLabels } from "../accounts/account-information.js";

const labels = {
  gender: "מגדר",
  price: "מחיר",
  monthlyTotal: "סך חודשי פעיל",
  allowed: "פתוח לצפייה",
  billing: "סוג חיוב",
  expiresAt: "תוקף גישה",
  purchasedAt: "תאריך רכישה",
  displayName: "שם",
  email: "דוא״ל",
  phone: "טלפון",
  customerNumber: "מספר לקוח",
  status: "סטטוס",
  monthlyPrice: "מחיר חודשי",
  includedCategories: "כלול בחבילה",
  language: "שפת תוכן",
  subtitles: "כתוביות",
  audio: "שפת שמע",
  video: "איכות תמונה",
  playback: "מהירות ניגון",
  textSize: "גודל טקסט",
  contrast: "ניגודיות",
  sound: "פלט שמע",
  year: "שנה",
  duration: "משך",
  category: "קטגוריה",
  number: "מספר ערוץ",
  categories: "קטגוריות",
  current: "משודר עכשיו",
  next: "בהמשך",
  date: "תאריך",
  percent: "התקדמות צפייה",
};
const valueText = (value) => (Array.isArray(value) ? value.join(" · ") : String(value));
const money = (value) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" }).format(value);
const factsFor = (object) =>
  Object.entries(object)
    .filter(
      ([key, value]) =>
        labels[key] && value != null && (typeof value !== "object" || Array.isArray(value)),
    )
    .map(([key, value]) => ({
      label: labels[key],
      value: ["price", "monthlyPrice", "monthlyTotal"].includes(key)
        ? money(value)
        : valueText(value),
    }));

function publicCard(id, item) {
  if (typeof item === "string") return { id, title: item, facts: [] };
  if (!item || typeof item !== "object") return null;
  const title = item.title || item.name || item.label;
  if (!title) return null;
  return {
    id,
    title,
    description: item.description || item.text || item.message || item.subtitle || null,
    facts: factsFor(item).slice(0, 6),
    badge: item.badge || null,
  };
}

export function informationCards(information) {
  if (!information) return [];
  if (Array.isArray(information)) {
    return information
      .map((item, index) => publicCard(String(item?.id ?? index), item))
      .filter(Boolean);
  }
  const cards = [];
  for (const [key, value] of Object.entries(information)) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const card = publicCard(`${key}:${item?.id ?? index}`, item);
        if (card) cards.push(card);
      });
    } else if (value && typeof value === "object") {
      const card = publicCard(key, value);
      if (card) cards.push(card);
    }
  }
  const main = publicCard("overview", information);
  if (main) cards.unshift(main);
  return cards;
}

export function userCards(category, info) {
  if (!info) return [];
  if (category === "purchases" || category === "access") return informationCards(info);
  if (category === "profile" || category === "preferences") {
    return Object.entries(info)
      .filter(([key, value]) => labels[key] && value != null && value !== "")
      .map(([key, value]) => ({
        id: key,
        title: labels[key],
        facts: [
          {
            label: labels[key],
            value:
              key === "gender"
                ? { male: "גבר", female: "אישה", other: "אחר", unspecified: "לא צוין" }[value] ||
                  valueText(value)
                : valueText(value),
          },
        ],
      }));
  }
  if (category === "subscription") {
    return [
      { id: "plan", title: info.planName || "NOVA TV", facts: factsFor(info) },
      ...(info.addOns || []).map((item, index) => ({
        id: `addon:${item.id ?? index}`,
        title: item.name,
        badge: "תוספת למנוי",
        facts: factsFor(item),
      })),
    ];
  }
  if (category === "library") {
    const names = accountPublicLabels(category, info);
    const cards = [];
    const favorites = (info.favoriteContentIds || [])
      .map((id) => names.contentTitles[id])
      .filter(Boolean);
    const channels = (info.favoriteChannelIds || [])
      .map((id) => names.channelNames[id])
      .filter(Boolean);
    if (favorites.length)
      cards.push({
        id: "favorite-content",
        title: "התכנים המועדפים שלך",
        facts: favorites.map((value) => ({ label: "תוכן", value })),
      });
    if (channels.length)
      cards.push({
        id: "favorite-channels",
        title: "הערוצים המועדפים שלך",
        facts: channels.map((value) => ({ label: "ערוץ", value })),
      });
    for (const item of info.watchProgress || []) {
      const title = names.contentTitles[item.contentId];
      if (title)
        cards.push({
          id: `progress:${item.contentId}`,
          title,
          progress: item.percent,
          badge: "ממשיכים לצפות",
          facts: [{ label: "התקדמות צפייה", value: `${item.percent}%` }],
        });
    }
    for (const item of info.recordings || []) {
      cards.push({
        id: `recording:${item.id}`,
        title: item.title || names.contentTitles[item.contentId],
        badge: "הקלטה",
        facts: factsFor(item),
      });
    }
    return cards;
  }
  if (category === "notifications") return informationCards(info);
  return [];
}
