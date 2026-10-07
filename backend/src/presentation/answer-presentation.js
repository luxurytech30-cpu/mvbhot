const titles = {
  purchases: "הרכישות שלך",
  access: "גישה לתוכן",
  offers: "רכישות ותוספות",
  libraries: "ספריות VOD",
  profile: "הפרטים שלך",
  subscription: "המנוי שלך",
  preferences: "ההעדפות שלך",
  library: "הספרייה שלך",
  billing: "החשבונות שלך",
  notifications: "ההודעות שלך",
  content: "סרטים וסדרות",
  channels: "ערוצים",
  programs: "תוכניות",
  apps: "אפליקציות",
  service: "חבילות ושירותים",
  categories: "קטגוריות צפייה",
  site: "אודות NOVA TV",
};
export function buildPresentation({ category, source, cards, displayIds, invoices = [] }) {
  const selectedIds = new Set(
    Array.isArray(displayIds) ? displayIds.filter((id) => typeof id === "string") : [],
  );
  return {
    title: titles[category] || (source === "user" ? "המידע בחשבון שלך" : "מידע מ־NOVA TV"),
    source,
    cards: cards.filter((card) => selectedIds.has(card.id)).slice(0, 8),
    invoices,
  };
}
