import { userInformationForCategory, publicLabelsForUserCategory } from "./private/user-info.js";

const labels = {
  displayName: "שם", email: "דוא״ל", phone: "טלפון", customerNumber: "מספר לקוח",
  status: "סטטוס", monthlyPrice: "מחיר חודשי", includedCategories: "כלול בחבילה",
  language: "שפת תוכן", subtitles: "כתוביות", audio: "שפת שמע", video: "איכות תמונה",
  playback: "מהירות ניגון", textSize: "גודל טקסט", contrast: "ניגודיות", sound: "פלט שמע",
  year: "שנה", duration: "משך", category: "קטגוריה", number: "מספר ערוץ", categories: "קטגוריות",
  current: "משודר עכשיו", next: "בהמשך", date: "תאריך", percent: "התקדמות צפייה",
};
const titles = {
  profile: "הפרטים שלך", subscription: "המנוי שלך", preferences: "ההעדפות שלך",
  library: "הספרייה שלך", billing: "החשבונות שלך", notifications: "ההודעות שלך",
  content: "סרטים וסדרות", channels: "ערוצים", programs: "תוכניות", apps: "אפליקציות",
  service: "חבילות ושירותים", categories: "קטגוריות צפייה", site: "אודות NOVA TV",
};
const valueText = value => Array.isArray(value) ? value.join(" · ") : String(value);
const money = value => new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" }).format(value);
const factsFor = object => Object.entries(object)
  .filter(([key, value]) => labels[key] && value != null && (typeof value !== "object" || Array.isArray(value)))
  .map(([key, value]) => ({ label: labels[key], value: key === "monthlyPrice" ? money(value) : valueText(value) }));

function publicCard(id, item) {
  if (typeof item === "string") return { id, title: item, facts: [] };
  if (!item || typeof item !== "object") return null;
  const title = item.title || item.name || item.label;
  if (!title) return null;
  return {
    id, title, description: item.description || item.text || item.message || item.subtitle || null,
    facts: factsFor(item).slice(0, 6), badge: item.badge || null,
  };
}

export function informationCards(information) {
  if (!information) return [];
  if (Array.isArray(information)) {
    return information.map((item, index) => publicCard(String(item?.id ?? index), item)).filter(Boolean);
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

export function userCards(category) {
  const info = userInformationForCategory(category);
  if (!info) return [];
  if (category === "profile" || category === "preferences") {
    return Object.entries(info).filter(([key, value]) => labels[key] && value != null && value !== "")
      .map(([key, value]) => ({ id: key, title: labels[key], facts: [{ label: labels[key], value: valueText(value) }] }));
  }
  if (category === "subscription") {
    return [
      { id: "plan", title: info.planName, facts: factsFor(info) },
      ...(info.addOns || []).map((item, index) => ({
        id: `addon:${item.id ?? index}`, title: item.name, badge: "תוספת למנוי", facts: factsFor(item),
      })),
    ];
  }
  if (category === "library") {
    const names = publicLabelsForUserCategory(category);
    const cards = [];
    const favorites = (info.favoriteContentIds || []).map(id => names.contentTitles[id]).filter(Boolean);
    const channels = (info.favoriteChannelIds || []).map(id => names.channelNames[id]).filter(Boolean);
    if (favorites.length) cards.push({ id: "favorite-content", title: "התכנים המועדפים שלך", facts: favorites.map(value => ({ label: "תוכן", value })) });
    if (channels.length) cards.push({ id: "favorite-channels", title: "הערוצים המועדפים שלך", facts: channels.map(value => ({ label: "ערוץ", value })) });
    for (const item of info.watchProgress || []) {
      const title = names.contentTitles[item.contentId];
      if (title) cards.push({ id: `progress:${item.contentId}`, title, progress: item.percent, badge: "ממשיכים לצפות", facts: [{ label: "התקדמות צפייה", value: `${item.percent}%` }] });
    }
    for (const item of info.recordings || []) {
      cards.push({ id: `recording:${item.id}`, title: item.title || names.contentTitles[item.contentId], badge: "הקלטה", facts: factsFor(item) });
    }
    return cards;
  }
  if (category === "notifications") return informationCards(info);
  return [];
}

// Select records locally so the answer and the statement refer to the same bills.
function invoiceMonth(invoice) {
  const value = invoice.periodStart || invoice.date || invoice.id;
  const iso = value.match(/^(20\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const local = value.match(/^\d{1,2}[./](\d{1,2})[./](20\d{2})$/);
  return local ? `${local[2]}-${local[1].padStart(2, "0")}` : "";
}

export function billingForQuestion(message) {
  const billing = userInformationForCategory("billing");
  if (!billing) return null;
  const invoices = [...(billing.invoices || [])].sort((a, b) => invoiceMonth(b).localeCompare(invoiceMonth(a)));
  let selected;
  const referenced = invoices.filter(invoice => message.includes(invoice.id) || (invoice.reference && message.includes(invoice.reference)));
  const date = message.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.]\d{1,2})?\b/);
  const reverseDate = message.match(/\b(0?[1-9]|1[0-2])[-/.](20\d{2})\b/);
  const months = ["ינואר|january|jan", "פברואר|february|feb", "מרץ|march|mar", "אפריל|april|apr", "מאי|may", "יוני|june|jun", "יולי|july|jul", "אוגוסט|august|aug", "ספטמבר|september|sep", "אוקטובר|october|oct", "נובמבר|november|nov", "דצמבר|december|dec"];
  const monthIndex = months.findIndex(pattern => new RegExp(`(?<![\\p{L}])(?:${pattern})(?![\\p{L}])`, "iu").test(message));
  const year = message.match(/\b20\d{2}\b/)?.[0];
  if (referenced.length) selected = referenced;
  else if (date || reverseDate || monthIndex >= 0) {
    const month = String(date ? Number(date[2]) : reverseDate ? Number(reverseDate[1]) : monthIndex + 1).padStart(2, "0");
    const requestedYear = date?.[1] || reverseDate?.[2] || year;
    selected = invoices.filter(invoice => invoiceMonth(invoice).slice(5, 7) === month
      && (!requestedYear || invoiceMonth(invoice).startsWith(requestedYear)));
  } else if (year) selected = invoices.filter(invoice => invoiceMonth(invoice).startsWith(year));
  else if (/חודש שעבר|חודש הקודם|last month|previous month/i.test(message)) {
    const now = new Date();
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    selected = invoices.filter(invoice => invoiceMonth(invoice) === previous);
  } else if (/השוו|השווא|התייקר|עלה|עלייה|כל החשבונ|כל החשבוניו|compare|increase|higher|all (?:my )?(?:bills|invoices)/i.test(message)) selected = invoices;
  else selected = invoices.slice(0, 1);
  return { ...billing, invoices: selected };
}

export function buildPresentation({ category, source, cards, displayIds, invoices = [] }) {
  const selectedIds = new Set(Array.isArray(displayIds) ? displayIds.filter(id => typeof id === "string") : []);
  return {
    title: titles[category] || (source === "user" ? "המידע בחשבון שלך" : "מידע מ־NOVA TV"),
    source,
    cards: cards.filter(card => selectedIds.has(card.id)).slice(0, 8),
    invoices,
  };
}
