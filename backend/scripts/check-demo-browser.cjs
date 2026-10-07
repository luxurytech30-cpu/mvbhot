// Run against the three local development services; uses only mock credentials.
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { mkdirSync, writeFileSync } = require("node:fs");
const demo = resolve(process.env.NOVA_DEMO_DIR || resolve(__dirname, "../../../../hot"));
const { chromium, expect } = createRequire(resolve(demo, "package.json"))("@playwright/test");
(async () => {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  try {
    const context = await browser.newContext({
      permissions: ["microphone"],
      viewport: { width: 1440, height: 1000 },
    });
    const tv = await context.newPage();
    const failures = [];
    tv.on("pageerror", (error) => failures.push(error.message));
    await tv.goto("http://127.0.0.1:5174/account");
    await expect(tv.getByRole("heading", { name: "כניסה לחשבון" })).toBeVisible();
    const artifacts = resolve(__dirname, "../../artifacts/browser-smoke");
    mkdirSync(artifacts, { recursive: true });
    await tv.screenshot({ path: resolve(artifacts, "login.png") });
    await tv.getByRole("button", { name: /משפחת כהן/ }).click();
    await tv.getByRole("button", { name: "כניסה לצפייה" }).click();
    await expect(tv.locator(".account-hero")).toContainText("משפחת כהן");
    await tv.screenshot({
      path: resolve(artifacts, "account.png"),
      fullPage: true,
    });
    await tv.goto("http://127.0.0.1:5174/service/packages");
    await expect(tv.locator('[data-focus-id="plan-nova-family"]')).toContainText("החבילה הנוכחית");
    await tv.screenshot({
      path: resolve(artifacts, "subscriptions.png"),
      fullPage: true,
    });
    const nova = await context.newPage();
    nova.on("pageerror", (error) => failures.push(error.message));
    let ready = false;
    nova.on("console", (message) => {
      if (message.text().includes("session_ready")) ready = true;
    });
    await nova.goto("http://127.0.0.1:5173");
    await expect(nova.locator(".account-bar")).toContainText("משפחת כהן");
    await expect(nova.locator(".account-bar")).toContainText("NOVA Family");
    await expect(nova.locator("#screen-select")).toHaveCount(0);
    await nova.getByRole("button", { name: "Start live conversation" }).click();
    await expect.poll(() => ready, { timeout: 25000 }).toBe(true);
    await expect(nova.getByRole("button", { name: "End conversation" })).toBeVisible();
    await nova.screenshot({ path: resolve(artifacts, "nova-live.png") });
    await nova.getByRole("button", { name: "End conversation" }).click();
    await expect(nova.getByRole("button", { name: "Start live conversation" })).toBeVisible();
    await tv.goto("http://127.0.0.1:5174/account");
    await tv.getByRole("button", { name: "התנתקות / החלפת חשבון" }).click();
    await expect(tv.getByRole("heading", { name: "כניסה לחשבון" })).toBeVisible();
    await nova.bringToFront();
    await nova.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(nova.getByRole("heading", { name: "Welcome to Nova" })).toBeVisible();
    expect(failures).toEqual([]);
    const report = {
      sharedAccount: true,
      subscriptionsVisible: true,
      liveModelConnected: true,
      microphone: "Chrome simulated audio",
      logout: true,
      pageErrors: failures,
      checkedAt: new Date().toISOString(),
    };
    writeFileSync(resolve(artifacts, "browser-check.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
