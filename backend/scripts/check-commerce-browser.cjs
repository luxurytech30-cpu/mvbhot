// Run only against scripts/browser-test-server.js and an isolated TV preview.
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { mkdirSync, writeFileSync } = require("node:fs");
const { chromium, expect } = createRequire(
  resolve(process.env.NOVA_DEMO_DIR || resolve(__dirname, "../../../../hot"), "package.json"),
)("@playwright/test");
const base = process.env.NOVA_TV_URL || "http://127.0.0.1:5187";
const artifact = resolve(__dirname, "../../artifacts/commerce-browser");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [],
    checks = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const control = (id) => page.locator(`[data-focus-id="${id}"]`);
  const session = async () =>
    (await (await context.request.get(`${base}/api/auth/session`)).json()).user;
  const visit = async (path) => {
    await page.goto(`${base}${path}`);
    await expect(
      page.locator(".top-navigation, .playback-access, .player-controls").first(),
    ).toBeVisible();
  };
  const confirm = async (id) => {
    await control(id).click();
    await control(`${id}-confirm`).click();
    await expect(control(`${id}-confirm`)).toHaveCount(0);
  };
  try {
    await page.goto(base);
    expect((await context.request.post(`${base}/api/test/reset`)).ok()).toBe(true);
    await page.reload();
    await page.locator("#login-email").fill("basic@nova.demo");
    await page.locator("#login-password").fill("NovaDemo123!");
    await control("login-submit").click();
    await expect(page.locator(".home-hero")).toBeVisible();
    checks.push("login and shared backend catalog");
    await visit("/channels");
    await expect(page.locator(".focus-grid .channel-card")).toHaveCount(14);
    await expect(page.locator(".channel-card .access-badge.locked")).toHaveCount(6);
    const initial = await session();
    expect(initial.billing.invoices[0].id).toBe("2026-10");
    expect(initial.billing.invoices[0].total).toBe(79);
    checks.push("all channels visible, Basic locks and October base charge");
    await visit("/player/beyond");
    await expect(page.getByRole("heading", { name: "התוכן נעול", exact: true })).toBeVisible();
    await expect(page.locator(".player-controls")).toHaveCount(0);
    checks.push("direct URL cannot bypass access");
    await visit("/content/beyond");
    await confirm("buy-rental-beyond");
    let user = await session();
    expect(user.billing.invoices[0].total).toBe(98);
    expect(user.access.content.find((item) => item.id === "beyond").allowed).toBe(true);
    const rental = user.purchases.items.find((item) => item.offerId === "rental-beyond");
    await visit("/service/packages");
    await confirm(`cancel-${rental.id}`);
    user = await session();
    expect(user.billing.invoices[0].total).toBe(79);
    expect(user.access.content.find((item) => item.id === "beyond").allowed).toBe(false);
    expect(user.billing.invoices[0].items.some((item) => item.amountIncludingTax === -19)).toBe(
      true,
    );
    checks.push("unused rental purchase and cancellation credit");
    await visit("/channels/55");
    await confirm("buy-event-match");
    user = await session();
    expect(user.access.channels.find((item) => item.id === "55").allowed).toBe(false);
    expect(user.access.programs.find((item) => item.id === "55-1").allowed).toBe(true);
    expect(user.access.programs.find((item) => item.id === "55-2").allowed).toBe(false);
    await visit("/player/program-55-1");
    await expect(page.locator(".player-controls")).toBeVisible();
    user = await session();
    const event = user.purchases.items.find((item) => item.offerId === "event-match");
    expect(Boolean(event.usedAt)).toBe(true);
    await visit("/service/packages");
    await expect(control(`cancel-${event.id}`)).toBeDisabled();
    checks.push("single match covers CatchUp, not the whole channel; used purchase cannot refund");
    await confirm("extra-channel-55");
    user = await session();
    expect(user.access.channels.find((item) => item.id === "55").allowed).toBe(true);
    expect(user.access.programs.find((item) => item.id === "55-2").allowed).toBe(true);
    expect(user.access.content.find((item) => item.id === "broadcast-55-2").allowed).toBe(false);
    const channel = user.purchases.items.find((item) => item.offerId === "channel-55");
    await confirm(`cancel-${channel.id}`);
    user = await session();
    expect(user.purchases.items.find((item) => item.id === channel.id).expiresAt).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(user.access.channels.find((item) => item.id === "55").allowed).toBe(true);
    checks.push("monthly channel purchase, prorated charge and cancellation retains paid access");
    await visit("/service/vod");
    await control("library-premiere").click();
    await expect(page).toHaveURL(/library=premiere/);
    await expect(page.locator(".content-row").first().locator(".content-card")).toHaveCount(2);
    await visit("/service/vod");
    await confirm("library-library-premiere");
    user = await session();
    expect(user.access.content.find((item) => item.id === "beyond").allowed).toBe(true);
    expect(user.access.content.find((item) => item.id === "orbit").allowed).toBe(true);
    checks.push("library filter and purchased library unlocks canonical titles");
    await visit("/account");
    await page.getByLabel("מגדר", { exact: true }).selectOption("other");
    await expect.poll(async () => (await session()).profile.gender).toBe("other");
    await visit("/service/packages");
    await confirm("plan-nova-family");
    user = await session();
    expect(user.subscription.planId).toBe("nova-family");
    expect(user.access.channels.find((item) => item.id === "18").allowed).toBe(true);
    expect(user.purchases.items.length).toBe(4);
    expect(user.billing.invoices[0].items.some((item) => item.sourceId === "nova-family")).toBe(
      true,
    );
    checks.push("gender saving and plan change retain purchases and calculate bill adjustments");
    await visit("/service/bills/2026-10");
    await expect(page.locator(".nova-invoice-sheet")).toContainText("אוקטובר 2026");
    await expect(page.locator(".nova-invoice-sheet")).toContainText("NOVA Family");
    await expect(page.locator(".nova-invoice-sheet")).toContainText("Premiere+");
    const download = page.waitForEvent("download");
    await control("invoice-download").click();
    expect((await download).suggestedFilename()).toContain("2026-10");
    checks.push("October invoice renders actual orders and downloads");
    mkdirSync(artifact, { recursive: true });
    await page.screenshot({ path: resolve(artifact, "october-bill.png"), fullPage: true });
    await visit("/service/packages");
    await page.screenshot({ path: resolve(artifact, "packages.png"), fullPage: true });
    await visit("/account");
    await control("account-logout").click();
    await page.locator("#login-email").fill("family@nova.demo");
    await page.locator("#login-password").fill("NovaDemo123!");
    await control("login-submit").click();
    await expect(page.locator(".account-hero-copy h2")).toHaveText("משפחת כהן");
    user = await session();
    expect(user.purchases.items.length).toBe(0);
    expect(user.billing.invoices[0].total).toBe(109);
    expect(user.profile.gender).toBe("unspecified");
    checks.push("second account cannot see first account purchases or charges");
    expect(errors).toEqual([]);
    writeFileSync(resolve(artifact, "report.json"), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, errors }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
