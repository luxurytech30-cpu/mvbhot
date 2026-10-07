export function validateCatalog(catalog) {
  const index = (records, field, label) => {
    const ids = new Set(records.map((item) => item[field]));
    if (ids.size !== records.length || ids.has(undefined)) throw new Error(`Invalid ${label} IDs`);
    return ids;
  };
  const content = index(catalog.content, "id", "content");
  const channels = index(catalog.channels, "id", "channel");
  const libraries = index(catalog.libraries, "id", "library");
  const programs = index(catalog.programs, "id", "program");
  index(catalog.plans, "planId", "plan");
  index(catalog.offers, "id", "offer");
  const known = (ids, set, source) => {
    if (!Array.isArray(ids) || ids.some((id) => !set.has(id)))
      throw new Error(`Unknown catalog reference: ${source}`);
  };
  for (const item of catalog.content) {
    known(item.libraryIds, libraries, item.id);
    for (const id of item.libraryIds) if (!catalog.libraries.find((library) => library.id === id).contentIds.includes(item.id))
      throw new Error(`Missing library membership: ${item.id}`);
  }
  for (const library of catalog.libraries) {
    known(library.contentIds, content, library.id);
    for (const id of library.contentIds)
      if (!catalog.content.find((item) => item.id === id).libraryIds.includes(library.id))
        throw new Error(`Inconsistent library membership: ${id}`);
  }
  for (const program of catalog.programs) {
    known([program.contentId], content, program.id);
    known([program.channelId], channels, program.id);
    if (Object.hasOwn(program, "title"))
      throw new Error(`Program duplicates content metadata: ${program.id}`);
    const timestamp = (date, time) => {
      const [day, month, year] = date.split(".").map(Number);
      const [hour, minute] = time.split(":").map(Number);
      return Date.UTC(year, month - 1, day, hour, minute);
    };
    const minutes = (timestamp(program.endDate || program.date, program.end) - timestamp(program.date, program.start)) / 60000;
    if (minutes !== catalog.content.find((item) => item.id === program.contentId).duration)
      throw new Error(`Program duration mismatch: ${program.id}`);
  }
  for (const channel of catalog.channels) {
    known([channel.currentProgramId, channel.nextProgramId], programs, channel.id);
    if (
      [channel.currentProgramId, channel.nextProgramId].some(
        (id) => catalog.programs.find((item) => item.id === id).channelId !== channel.id,
      )
    )
      throw new Error(`Channel schedule mismatch: ${channel.id}`);
  }
  for (const item of [...catalog.plans, ...catalog.offers]) {
    known(item.channelIds, channels, item.planId || item.id);
    known(item.libraryIds, libraries, item.planId || item.id);
    const price = item.monthlyPrice ?? item.price;
    if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid catalog price");
    if (item.contentIds) known(item.contentIds, content, item.id);
    if (
      item.billing === "oneTime" &&
      (!Number.isFinite(item.durationHours) || item.durationHours <= 0)
    )
      throw new Error("Invalid purchase duration");
  }
  known(catalog.accessPolicy.baseChannelIds, channels, "base channels");
  known(catalog.accessPolicy.baseLibraryIds, libraries, "base libraries");
}
