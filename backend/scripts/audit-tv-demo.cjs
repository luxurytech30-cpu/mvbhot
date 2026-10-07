// Audit the rendered TV website against Nova's own data. Never reads TV JSON exports.
// Use an isolated browser-test API when checking account-changing controls separately.
const { mkdirSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const demo = resolve(process.env.NOVA_DEMO_DIR || resolve(__dirname, "../../../../hot"));
const { chromium, expect } = createRequire(resolve(demo, "package.json"))("@playwright/test");

async function auditTV(url = process.env.NOVA_TV_URL || "http://127.0.0.1:5174") {
  const { publicTVData } = await import(
    pathToFileURL(resolve(__dirname, "../src/information/catalog-data.js"))
  );
  const catalog = publicTVData();
  const { screenFromPath } = await import(
    pathToFileURL(resolve(__dirname, "../src/navigation/navigation-routes.js"))
  );
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const report = { pages: [], interactions: [], browserErrors: [] };
  let page;
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    page = await context.newPage();
    page.on("pageerror", (error) => report.browserErrors.push(error.message));
    const visit = async (path, expectedScreen) => {
      expect(screenFromPath(path), path).toBe(expectedScreen);
      await page.goto(new URL(path, url).href, { waitUntil: "domcontentloaded" });
      await expect(
        page.locator(".top-navigation, .player-page, .playback-access").first(),
      ).toBeVisible();
      await expect(page.locator(".empty-page")).toHaveCount(0);
      report.pages.push({ path, screen: expectedScreen });
    };
    const control = (id) => page.locator(`[data-focus-id="${id}"]`);
    const pressBack = async () => {
      // Let the popup's back-handler effect and focus restoration settle.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await page.keyboard.press("Escape");
    };
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "כניסה לחשבון" })).toBeVisible();
    await expect(page.locator(".demo-account")).toHaveCount(3);
    await page.locator("#login-email").fill("premium@nova.demo");
    await page.locator("#login-password").fill("NovaDemo123!");
    await control("login-submit").click();
    await expect(page.locator(".home-hero")).toBeVisible();
    report.interactions.push("login");
    const sessionResponse = await context.request.get(new URL("/api/auth/session", url).href);
    expect(sessionResponse.ok()).toBe(true);
    const { user } = await sessionResponse.json();

    await visit("/", "home");
    for (const [index, id] of catalog.home.featuredContentIds.entries()) {
      await control(`slide-${index}`).click();
      await expect(page.locator(".hero-copy h1")).toHaveText(
        catalog.content.find((item) => item.id === id).title,
      );
    }
    report.interactions.push("home carousel");
    await control("slide-0").click(); // Horizon is universal; Premiere titles can correctly be locked.
    await control("hero-details").click();
    await expect(page).toHaveURL(/\/content\//);
    await control("content-play").click();
    await expect(page.locator(".player-controls")).toBeVisible();
    report.interactions.push("home details to playback");

    await visit("/vod", "vod");
    for (const category of catalog.categories.vod) {
      await page.getByRole("tab", { name: category, exact: true }).click();
      await expect(page.getByRole("tab", { name: category, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screenFromPath(new URL(page.url()).pathname + new URL(page.url()).search)).toBe(
        category === "הכל" ? "vod" : "vod_category",
      );
    }
    report.interactions.push("all VOD filters");
    await visit("/channels", "channels");
    await expect(page.locator(".focus-grid .channel-card")).toHaveCount(catalog.channels.length);
    for (const item of catalog.content.filter((item) => item.vod)) {
      await visit(`/content/${item.id}`, "content_details");
      await expect(page.locator(".details-copy h1")).toHaveText(item.title);
      await expect(page.locator(".details-description")).toHaveText(item.description);
      await expect(control("content-favorite")).toBeVisible();
      await visit(`/player/${item.id}`, "vod_player");
      if (user.access.content.find((entry) => entry.id === item.id)?.allowed)
        await expect(page.locator(".player-center h1")).toHaveText(item.title);
      else await expect(page.locator(".playback-access h1")).toHaveText("התוכן נעול");
    }
    for (const channel of catalog.channels) {
      await visit(`/channels/${channel.id}`, "channel_details");
      await expect(page.locator(".channel-detail-copy h2")).toHaveText(channel.current);
      await expect(page.locator(".up-next h2")).toHaveText(channel.next);
      await expect(control("channel-favorite")).toBeVisible();
      await visit(`/player/live-${channel.id}`, "live_player");
      await expect(page.locator(".player-center h1")).toHaveText(channel.current);
      await visit(`/catchup/${channel.id}`, "catchup_channel");
      await expect(page.locator(".program-list-item")).toHaveCount(
        catalog.programs.filter((item) => item.channelId === channel.id).length,
      );
    }
    await visit("/catchup", "catchup");
    for (const category of catalog.categories.catchup) {
      await page.getByRole("tab", { name: category, exact: true }).click();
      const count = catalog.channels.filter(
        (item) => category === "הכל" || item.category === category,
      ).length;
      await expect(page.locator(".focus-grid .channel-card")).toHaveCount(count);
    }
    report.interactions.push("all CatchUp filters");
    await visit("/tv-guide", "tv_guide");
    await expect(page.locator(".guide-program")).toHaveCount(catalog.programs.length);
    await expect(page.locator(".page-heading")).toContainText(catalog.guide.date);
    for (const program of catalog.programs) {
      await visit(`/program/${program.id}`, "program_details");
      await expect(page.locator(".details-copy h1")).toHaveText(program.title);
      await expect(page.locator(".details-description")).toHaveText(program.description);
      await expect(control("program-record")).toBeVisible();
      await visit(`/player/program-${program.id}`, "program_player");
      await expect(page.locator(".player-center h1")).toHaveText(program.title);
    }
    await visit("/apps", "applications");
    await expect(page.locator(".app-card")).toHaveCount(catalog.apps.length);
    for (const app of catalog.apps) {
      await visit(`/apps/${app.id}`, "application_details");
      await expect(page.locator(".app-detail-page h1")).toHaveText(app.name);
      await expect(page.locator(".app-detail-page h2")).toHaveText(app.tagline);
      await expect(control("app-return")).toBeVisible();
    }
    await visit("/settings", "settings");
    await expect(page.locator(".settings-category")).toHaveCount(catalog.settingsCategories.length);
    const settingsScreens = {
      picture: "settings_picture",
      audio: "settings_sound",
      language: "settings_language",
      subtitles: "settings_subtitles",
      accessibility: "settings_accessibility",
      network: "settings_network",
      account: "settings_account",
      system: "settings_system",
    };
    const optionScreens = {
      "picture/quality": "settings_picture",
      "audio/language": "settings_sound_language",
      "audio/output": "settings_sound_output",
      "language/language": "settings_language",
      "subtitles/subtitles": "settings_subtitles",
      "accessibility/subtitles": "settings_accessibility_subtitles",
      "accessibility/text-size": "settings_text_size",
      "accessibility/contrast": "settings_contrast",
      "network/status": "settings_network_status",
      "account/profile": "settings_account_profile",
      "system/about": "settings_system_about",
    };
    for (const category of catalog.settingsCategories) {
      await visit(`/settings/${category.id}`, settingsScreens[category.id]);
      for (const option of category.options) {
        await visit(
          `/settings/${category.id}/${option.id}`,
          optionScreens[`${category.id}/${option.id}`],
        );
        for (const value of option.values || [])
          await expect(page.getByRole("button", { name: value, exact: true })).toBeVisible();
        for (const line of (option.info || "").split("\n").filter(Boolean))
          await expect(page.locator(".info-panel")).toContainText(line);
        if (category.id === "account")
          await expect(page.locator(".info-panel")).toContainText(user.profile.displayName);
      }
    }
    await visit("/service", "service");
    for (const item of catalog.service.supportItems) {
      await control(`support-${item.id}`).click();
      await expect(page.getByRole("dialog")).toContainText(item.message);
      await pressBack();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    report.interactions.push("four support popups");
    await visit("/service/packages", "packages");
    for (const plan of catalog.service.plans) {
      await expect(control(`plan-${plan.id}`).locator("..")).toContainText(plan.name);
      await expect(control(`plan-${plan.id}`).locator("..")).toContainText(`₪${plan.monthlyPrice}`);
    }
    await visit("/service/vod", "vod_libraries");
    for (const library of catalog.libraries) {
      await visit("/service/vod", "vod_libraries");
      await control(`library-${library.id}`).click();
      await expect(page).toHaveURL(new RegExp(`/vod\\?library=${library.id}$`));
    }
    report.interactions.push(`all ${catalog.libraries.length} library destinations`);
    await visit("/recordings", "recordings");
    for (const recording of user.library.recordings) {
      await visit(`/recordings/${recording.id}`, "recording_details");
      await expect(page.locator(".details-copy h1")).toHaveText(recording.title);
      await control("recording-play").click();
      await expect(page.locator(".player-page")).toBeVisible();
    }
    await visit("/favorites", "favorites");
    await visit("/account", "account");
    await expect(page.locator(".account-hero")).toContainText(user.profile.displayName);
    await control(`account-bill-${user.billing.invoices[0].id}`).click();
    await expect(page).toHaveURL(/\/service\/bills\/[^/]+$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    report.interactions.push("account invoice opens details first");
    await visit("/service/bills", "bills");
    for (const bill of user.billing.invoices) {
      await visit(`/service/bills/${bill.id}`, "bill_details");
      await expect(page.locator(".bill-detail-heading")).toContainText(bill.reference);
      await control("invoice-view").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const downloadEvent = page.waitForEvent("download");
      await control("invoice-modal-download").click();
      expect((await downloadEvent).suggestedFilename()).toMatch(/\.html$/);
      await pressBack();
    }
    report.interactions.push("invoice popup and HTML download");
    await visit("/search", "search");
    await control("search-input").fill("חדשות");
    await expect(page.locator(".results-count")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/search");
    await control("keyboard-language").click();
    await expect(control("key-a")).toBeVisible();
    await control("keyboard-clear").click();
    await expect(page.locator(".results-count")).toHaveCount(0);
    report.interactions.push("search results and keyboard are local state");

    await visit("/player/horizon", "vod_player");
    await control("player-hide").click();
    await expect(page.locator(".player-controls")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.locator(".player-controls")).toBeVisible();
    await control("player-subtitles").click();
    expect(screenFromPath(new URL(page.url()).pathname + new URL(page.url()).search)).toBe(
      "subtitles",
    );
    for (const value of catalog.playback.subtitles)
      await expect(page.getByRole("button", { name: value, exact: true })).toBeVisible();
    await pressBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/player\/horizon$/);
    await control("player-audio").click();
    expect(screenFromPath(new URL(page.url()).pathname + new URL(page.url()).search)).toBe(
      "audio_options",
    );
    await pressBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/player\/horizon$/);
    for (const [panel, screen, values] of [
      ["audio", "audio_options_from_settings", catalog.playback.audioLanguages],
      ["video", "video_options", catalog.playback.videoQualities],
      ["playback", "playback_options", Object.keys(catalog.playback.speeds)],
    ]) {
      await control("player-settings").click();
      await control(`player-setting-${panel}`).click();
      expect(screenFromPath(new URL(page.url()).pathname + new URL(page.url()).search)).toBe(
        screen,
      );
      for (const value of values)
        await expect(page.getByRole("button", { name: value, exact: true })).toBeVisible();
      await pressBack();
      await expect(page.getByRole("dialog")).toHaveAccessibleName("הגדרות נגן");
      await page.locator('[role="dialog"] [data-focus-id="modal-close"]').click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/player\/horizon$/);
    }
    report.interactions.push(
      "hidden controls, subtitles, direct audio, nested audio/video/speed and closing",
    );
    await page.keyboard.press("m");
    await expect(page.getByRole("dialog")).toHaveAccessibleName("התפריט שלכם");
    await control("menu-account").click();
    await expect(page).toHaveURL(/\/account$/);
    await control("notifications").click();
    await expect(page.getByRole("dialog")).toContainText(user.notifications[0].title);
    await pressBack();
    report.interactions.push("menu from player, account and notifications");
    await page.goto(new URL("/invalid-page", url).href);
    await expect(page.locator(".empty-page")).toBeVisible();
    await control("notfound-home").click();
    await expect(page.locator(".home-hero")).toBeVisible();
    report.interactions.push("not-found recovery");
    await visit("/account", "account");
    await control("account-logout").click();
    await expect(page.getByRole("heading", { name: "כניסה לחשבון" })).toBeVisible();
    report.interactions.push("logout");
    for (const email of ["family@nova.demo", "basic@nova.demo"]) {
      await page.locator("#login-email").fill(email);
      await page.locator("#login-password").fill("NovaDemo123!");
      await control("login-submit").click();
      await expect(page.locator(".account-hero")).toBeVisible();
      const accountResponse = await context.request.get(new URL("/api/auth/session", url).href);
      const account = (await accountResponse.json()).user;
      const plan = account.subscription.planName;
      await expect(page.locator(".account-stats")).toContainText(plan);
      await visit("/recordings", "recordings");
      await expect(page.locator(".recording-card")).toHaveCount(0);
      await visit("/favorites", "favorites");
      if (email === "basic@nova.demo") await expect(page.locator(".empty-message")).toHaveCount(3);
      await visit("/service/packages", "packages");
      await expect(page.locator(".plan-option.active")).toContainText(plan);
      await visit("/account", "account");
      await control("account-logout").click();
      await expect(page.getByRole("heading", { name: "כניסה לחשבון" })).toBeVisible();
    }
    report.interactions.push("Family and Basic accounts and empty lists");
    expect(report.browserErrors).toEqual([]);
    report.catalogCounts = Object.fromEntries(
      ["content", "channels", "programs", "apps", "settingsCategories", "libraries", "offers"].map(
        (key) => [key, catalog[key].length],
      ),
    );
    report.reviewedOn = "2026-10-03";
    const output = resolve(__dirname, "../../artifacts/tv-audit");
    mkdirSync(output, { recursive: true });
    writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        verifiedPages: report.pages.length,
        interactions: report.interactions,
        counts: report.catalogCounts,
        browserErrors: report.browserErrors,
      }),
    );
    return report;
  } catch (error) {
    console.error(
      JSON.stringify({
        completedPages: report.pages.length,
        completedInteractions: report.interactions,
        failedAt: page?.url(),
      }),
    );
    throw error;
  } finally {
    await browser.close();
  }
}
module.exports = { auditTV };
if (require.main === module)
  auditTV().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
