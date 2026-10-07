import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { plans } from "./subscription-plans.js";

export const demoAccountTemplate = JSON.parse(
  readFileSync(new URL("./demo-account-template.json", import.meta.url), "utf8"),
).user;
export const demoAccounts = [
  { email: "premium@nova.demo", name: "אורח", plan: "nova-premium" },
  { email: "family@nova.demo", name: "משפחת כהן", plan: "nova-family" },
  { email: "basic@nova.demo", name: "דנה לוי", plan: "nova-basic" },
];
export function createInitialAccounts() {
  return demoAccounts.map((account, index) => {
    const user = structuredClone(demoAccountTemplate);
    user.id = index ? `demo-user-00${index + 1}` : demoAccountTemplate.id;
    user.profile = {
      ...user.profile,
      displayName: account.name,
      email: account.email,
      customerNumber: `NOVA-DEMO-00${index + 1}`,
      gender: ["male", "unspecified", "female"][index],
    };
    user.subscription = {
      ...structuredClone(plans.find((plan) => plan.planId === account.plan)),
      status: "פעיל בהדגמה",
    };
    if (index) {
      user.library = {
        favoriteContentIds: index === 1 ? ["blue-world"] : [],
        favoriteChannelIds: index === 1 ? ["11"] : [],
        recordings: [],
        watchProgress: [],
      };
      user.notifications = [
        {
          id: "welcome",
          title: `ברוכים הבאים, ${account.name}`,
          message: "החשבון האישי שלכם מוכן לצפייה.",
        },
      ];
      user.billing.invoices = user.billing.invoices.map((invoice) => ({
        ...invoice,
        reference: `${user.id}-${invoice.id}`,
        customerNumber: user.profile.customerNumber,
        subtotal: user.subscription.monthlyPrice,
        discounts: 0,
        total: user.subscription.monthlyPrice,
        items: [
          {
            ...invoice.items[0],
            name: user.subscription.planName,
            amountIncludingTax: user.subscription.monthlyPrice,
            amountBeforeTax: Number((user.subscription.monthlyPrice / 1.18).toFixed(2)),
          },
        ],
      }));
    }
    const salt = randomBytes(16).toString("hex");
    return {
      user,
      salt,
      passwordHash: scryptSync("NovaDemo123!", salt, 64).toString("hex"),
    };
  });
}
