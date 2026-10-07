import { catalog, offerById } from "../information/catalog-data.js";

export const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const localDate = (date) => date.toISOString().slice(0, 10).split("-").reverse().join(".");
export function billingMonth(now = new Date()) {
  const year = now.getUTCFullYear(),
    month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const next = new Date(Date.UTC(year, month + 1, 1));
  const end = new Date(next.getTime() - 86400000);
  return {
    id: start.toISOString().slice(0, 7),
    start: localDate(start),
    end: localDate(end),
    today: localDate(now),
    next: next.toISOString(),
    fraction: (end.getUTCDate() - now.getUTCDate() + 1) / end.getUTCDate(),
    name: new Intl.DateTimeFormat("he-IL", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(start),
  };
}
export function addCharge(
  user,
  { name, amount, category = "recurring", sourceId, periodStart },
  now,
) {
  const month = billingMonth(now);
  user.billing.ledger.entries.push({
    name,
    category,
    sourceId,
    periodStart: periodStart || month.today,
    periodEnd: category === "oneTime" ? month.today : month.end,
    quantity: 1,
    amountIncludingTax: money(amount),
    amountBeforeTax: money(amount / (1 + catalog.accessPolicy.taxRate)),
  });
}
export function ensureBillingMonth(user, now) {
  const month = billingMonth(now);
  if (user.billing.ledger?.month === month.id) return;
  if (user.billing.ledger?.month && user.billing.ledger.month < month.id) {
    const next = new Date(`${user.billing.ledger.month}-01T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    if (billingMonth(next).id < month.id) ensureBillingMonth(user, next);
  }
  // Freeze the previous draft before starting a new calendar month.
  if (user.billing.ledger?.month) {
    rebuildCurrentBill(user, new Date(`${user.billing.ledger.month}-01T00:00:00Z`));
    const previous = user.billing.invoices.find((item) => item.id === user.billing.ledger.month);
    if (previous?.status === "draft") previous.status = "issued";
  }
  user.billing.ledger = { month: month.id, entries: [] };
  if (!user.subscription.cancelAt || new Date(user.subscription.cancelAt) > now) {
    addCharge(
      user,
      {
        name: user.subscription.planName,
        amount: user.subscription.monthlyPrice,
        sourceId: user.subscription.planId,
        periodStart: month.start,
      },
      now,
    );
  }
  for (const purchase of user.purchases.items) {
    const offer = offerById.get(purchase.offerId);
    if (offer?.billing === "monthly" && purchase.status === "active") {
      addCharge(
        user,
        { name: offer.name, amount: offer.price, sourceId: purchase.id, periodStart: month.start },
        now,
      );
    }
  }
}
export function rebuildCurrentBill(user, now) {
  const month = billingMonth(now);
  const items = structuredClone(user.billing.ledger.entries);
  const subtotal = money(
    items
      .filter((item) => item.amountIncludingTax >= 0)
      .reduce((sum, item) => sum + item.amountIncludingTax, 0),
  );
  const discounts = money(
    items
      .filter((item) => item.amountIncludingTax < 0)
      .reduce((sum, item) => sum + item.amountIncludingTax, 0),
  );
  const bill = {
    id: month.id,
    month: month.name,
    periodStart: month.start,
    periodEnd: month.end,
    date: month.start,
    dueDate: month.end,
    paidAt: null,
    reference: `${user.id}-${month.id}`,
    customerNumber: user.profile.customerNumber,
    status: "draft",
    currency: "ILS",
    items,
    subtotal,
    discounts,
    previousBalance: 0,
    total: money(subtotal + discounts),
    note: "חשבון הדגמה פתוח, מחושב מהחיובים בפועל. המחירים כוללים מע״מ הדגמה של 18%. שינוי חבילה ורכישה חודשית מחושבים לפי הימים שנותרו; ביטול חודשי מפסיק חידוש בסוף החודש.",
  };
  user.billing.invoices = [
    bill,
    ...user.billing.invoices.filter((item) => item.id !== month.id),
  ].sort((a, b) => b.id.localeCompare(a.id));
}
