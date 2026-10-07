import { randomUUID } from "node:crypto";
import { plans } from "./subscription-plans.js";
import { offerById, catalog } from "../information/catalog-data.js";
import { accessFor, purchaseActive, accountAccess } from "./account-access.js";
import {
  addCharge,
  billingMonth,
  ensureBillingMonth,
  rebuildCurrentBill,
} from "./account-billing.js";

const bad = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export function normalizeCommerce(user, now = new Date()) {
  delete user.access; // Persist contracts; derive access instead of trusting a saved access flag.
  user.profile.gender ??= "unspecified";
  if (!user.purchases) {
    user.purchases = { items: [] };
    const plan = plans.find((item) => item.planId === user.subscription.planId);
    user.subscription = { ...structuredClone(plan || plans[0]), status: user.subscription.status };
  }
  ensureBillingMonth(user, now);
  rebuildCurrentBill(user, now);
  if (user.subscription.cancelAt && new Date(user.subscription.cancelAt) <= now)
    user.subscription.status = "המנוי בוטל";
  user.subscription.addOns = user.purchases.items
    .filter(
      (item) =>
        item.billing === "monthly" && purchaseActive(item, now) && offerById.has(item.offerId),
    )
    .map((item) => ({
      ...offerById.get(item.offerId),
      monthlyPrice: offerById.get(item.offerId).price,
      purchaseId: item.id,
      status: item.status,
      endsAt: item.expiresAt,
    }));
  user.subscription.monthlyTotal =
    (!user.subscription.cancelAt || new Date(user.subscription.cancelAt) > now
      ? user.subscription.monthlyPrice
      : 0) + user.subscription.addOns.reduce((sum, item) => sum + item.monthlyPrice, 0);
  return user;
}
export function accountView(user, now) {
  normalizeCommerce(user, now);
  user.access = accountAccess(user, now);
  return user;
}
export function applyCommerceChange(user, change, now) {
  normalizeCommerce(user, now);
  const month = billingMonth(now);
  const { operation, id } = change;
  if (operation === "profile") {
    if (
      change.key !== "gender" ||
      !["female", "male", "other", "unspecified"].includes(change.value)
    )
      bad("Invalid gender");
    user.profile.gender = change.value;
  } else if (operation === "purchase") {
    const offer = offerById.get(id);
    if (!offer) bad("Unknown offer");
    const existing = user.purchases.items.find(
      (item) => item.offerId === id && purchaseActive(item, now),
    );
    if (existing) {
      if (existing.billing === "monthly" && existing.status === "cancelled") {
        existing.status = "active";
        existing.expiresAt = null;
      } else bad("This purchase is already active", 409);
    } else {
      const covered = offer.libraryIds.length
        ? offer.libraryIds.every((key) => accessFor(user, "library", key, now).allowed)
        : offer.channelIds.length
          ? offer.channelIds.every((key) => accessFor(user, "channel", key, now).allowed)
          : offer.contentIds.every((key) => accessFor(user, "content", key, now).allowed);
      if (covered) bad("Already included or purchased; no extra charge is needed", 409);
      const purchase = {
        id: randomUUID(),
        offerId: offer.id,
        name: offer.name,
        billing: offer.billing,
        price: offer.price,
        status: "active",
        purchasedAt: now.toISOString(),
        usedAt: null,
        expiresAt:
          offer.billing === "oneTime"
            ? new Date(now.getTime() + offer.durationHours * 3600000).toISOString()
            : null,
      };
      if (user.purchases.items.length >= 200) bad("Demo purchase history limit reached", 409);
      user.purchases.items.push(purchase);
      addCharge(
        user,
        {
          name: offer.name,
          amount: offer.price * (offer.billing === "monthly" ? month.fraction : 1),
          category: offer.billing === "monthly" ? "recurring" : "oneTime",
          sourceId: purchase.id,
        },
        now,
      );
    }
  } else if (operation === "cancel_purchase") {
    const purchase = user.purchases.items.find((item) => item.id === id);
    if (!purchase || purchase.status !== "active") bad("No active purchase to cancel", 409);
    if (purchase.billing === "monthly") {
      purchase.status = "cancelled";
      purchase.expiresAt = month.next;
    } else {
      if (purchase.usedAt)
        bad("Playback has started; this one-time purchase cannot be refunded", 409);
      purchase.status = "cancelled";
      const chargeMonth = purchase.purchasedAt.slice(0, 7);
      if (chargeMonth !== month.id)
        bad("Only an unused purchase from the open billing month can be refunded", 409);
      addCharge(
        user,
        {
          name: `זיכוי ביטול — ${purchase.name}`,
          amount: -purchase.price,
          category: "credit",
          sourceId: purchase.id,
        },
        now,
      );
    }
  } else if (operation === "subscription") {
    const plan = plans.find((item) => item.planId === id);
    if (!plan) bad("Unknown subscription");
    if (plan.planId === user.subscription.planId && !user.subscription.cancelAt)
      bad("This plan is already active", 409);
    const active = !user.subscription.cancelAt || new Date(user.subscription.cancelAt) > now;
    if (plan.planId === user.subscription.planId && active) {
      user.subscription.cancelAt = null;
      user.subscription.status = "פעיל בהדגמה";
    } else {
      if (active)
        addCharge(
          user,
          {
            name: `זיכוי ימים שלא נוצלו — ${user.subscription.planName}`,
            amount: -user.subscription.monthlyPrice * month.fraction,
            category: "credit",
            sourceId: user.subscription.planId,
          },
          now,
        );
      user.subscription = { ...structuredClone(plan), status: "פעיל בהדגמה", cancelAt: null };
      addCharge(
        user,
        { name: plan.planName, amount: plan.monthlyPrice * month.fraction, sourceId: plan.planId },
        now,
      );
    }
  } else if (operation === "cancel_subscription") {
    if (user.subscription.cancelAt) bad("Cancellation is already scheduled", 409);
    user.subscription.cancelAt = month.next;
    user.subscription.status = "ביטול בסוף החודש";
  } else return false;
  normalizeCommerce(user, now);
  return true;
}
export function authorizePlayback(user, { kind, id }, now) {
  if (!["content", "channel", "program"].includes(kind)) bad("Invalid playback type");
  normalizeCommerce(user, now);
  let access = accessFor(user, kind, id, now);
  let contentId =
    kind === "content"
      ? id
      : kind === "program"
        ? catalog.programs.find((item) => item.id === id)?.contentId
        : null;
  if (kind === "channel") {
    const channel = catalog.channels.find((item) => item.id === id);
    const program = catalog.programs.find((item) => item.id === channel.currentProgramId);
    contentId = program.contentId;
    // An event pass permits only its current event, never the channel's other shows.
    if (!access.allowed) {
      const eventPurchase = user.purchases.items.find(
        (item) =>
          purchaseActive(item, now) &&
          offerById.get(item.offerId)?.kind === "event" &&
          offerById.get(item.offerId).contentIds.includes(contentId),
      );
      if (eventPurchase)
        access = { ...access, allowed: true, reason: "current_event_pass", purchaseOptions: [] };
    }
  }
  if (!access.allowed) bad("This title or channel is locked for your account", 403);
  for (const purchase of user.purchases.items) {
    if (
      purchase.billing === "oneTime" &&
      !purchase.usedAt &&
      purchaseActive(purchase, now) &&
      offerById.get(purchase.offerId)?.contentIds.includes(contentId)
    )
      purchase.usedAt = now.toISOString();
  }
  return access;
}
