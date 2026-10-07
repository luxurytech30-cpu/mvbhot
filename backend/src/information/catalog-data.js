import { readFileSync } from "node:fs";
import { validateCatalog } from "./catalog-validation.js";

// One public catalog supplies the TV API, account access rules and Nova's data tools.
export const catalog = JSON.parse(
  readFileSync(new URL("./tv-catalog.json", import.meta.url), "utf8"),
);
validateCatalog(catalog);
export const publicPlanSummaries = catalog.plans.map((plan) => ({
  id: plan.planId, name: plan.planName, monthlyPrice: plan.monthlyPrice,
  categories: plan.includedCategories, channelIds: plan.channelIds,
  libraryIds: plan.libraryIds, description: plan.description, addOns: [],
}));
export const contentById = new Map(catalog.content.map((item) => [item.id, item]));
export const programById = new Map(catalog.programs.map((item) => [item.id, item]));
export const offerById = new Map(catalog.offers.map((item) => [item.id, item]));
export const resolvedPrograms = catalog.programs.map((program) => ({
  ...contentById.get(program.contentId),
  ...program,
}));
const resolvedById = new Map(resolvedPrograms.map((program) => [program.id, program]));
export const resolvedChannels = catalog.channels.map((channel) => ({
  ...channel,
  current: resolvedById.get(channel.currentProgramId)?.title,
  next: resolvedById.get(channel.nextProgramId)?.title,
}));
export function publicTVData() {
  return { ...catalog, programs: resolvedPrograms, channels: resolvedChannels,
    service: { ...catalog.service, plans: publicPlanSummaries,
      libraries: catalog.libraries.map(({ id, name, description }) => ({ id, name, description })) } };
}
