import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createAssistantTools } from "../src/tools/assistant-tools.js";
import { toolCatalog } from "../src/tools/tool-definitions.js";
import { demoAccountTemplate } from "../src/accounts/demo-accounts.js";
import { accountInformationForCategory } from "../src/accounts/account-information.js";
import { publicInformationForCategory } from "../src/information/public-catalog.js";
import { buildNavigationRoute } from "../src/navigation/navigation-routes.js";
import { tvScreenContext } from "../src/live/tv-screen-context.js";

const call = (name, args, id = "lookup") => ({ name, args, id });

test("direct navigation returns the exact graph route", () => {
  const execute = createAssistantTools("home.png", { getUser: () => demoAccountTemplate });
  const output = execute(
    call("get_navigation_route", {
      question: "Open settings",
      targetScreen: "settings",
    }),
  );
  const route = buildNavigationRoute({
    imageName: "home.png",
    targetScreen: "settings",
    userIntent: "Open settings",
  });
  assert.deepEqual(output.result.steps, route.steps);
  assert.equal(output.response.instruction, route.finalInstruction);
  assert.equal(output.result.answer, ""); // Written answers come from Gemini's spoken transcription.
});

test("page information returns named catalog items and reported menu controls", () => {
  const context = {
    imageName: "vod.png",
    path: "/vod",
    uiState: { menuOpen: false, dialog: null },
  };
  const execute = createAssistantTools("home.png", {
    getUser: () => demoAccountTemplate,
    getContext: () => context,
  });
  const page = execute(call("get_page_information", { question: "What is on this page?" })).response;
  assert.equal(page.screenId, "vod");
  assert.ok(page.content.items.some((item) => item.id === "horizon" && item.name));
  assert.ok(page.controls.some((control) => control.id === "SELECT_CONTENT"));

  context.uiState.menuOpen = true;
  const menu = execute(call("get_page_information", { question: "What is open?" })).response;
  assert.equal(menu.screenId, "side_menu");
  assert.ok(menu.controls.some((control) => control.id === "SELECT_VOD"));
  assert.equal(JSON.parse(tvScreenContext(context)).uiState.menuOpen, true);
});

test("documented person button is found from its icon and position", () => {
  const execute = createAssistantTools("home.png");
  const page = execute(call("get_page_information", {
    question: "Where is the human button on the left?",
    controlDescription: "human button on the left",
  })).response;
  assert.equal(page.controlMatch.status, "matched");
  assert.equal(page.controls.length, 1);
  assert.equal(page.controls[0].icon, "person");
  assert.equal(page.controls[0].position, "top-left");
  assert.equal(page.controls[0].targetScreen, "account");
  const route = execute(call("get_navigation_route", {
    question: "Open the human button on the left",
    goal: "open_control",
    controlDescription: "human button on the left",
  })).response;
  assert.equal(route.targetScreen, "account");
});

test("vague watch goals ask before routing, while an exact title uses its catalog control", () => {
  const execute = createAssistantTools("home.png");
  const vague = execute(call("get_navigation_route", {
    question: "I want to watch something", goal: "watch",
  }));
  assert.equal(vague.response.needsClarification, true);
  assert.deepEqual(vague.result.steps, []);
  const vodWithoutTitle = execute(call("get_navigation_route", {
    question: "I want a movie", goal: "watch", itemKind: "content",
  }));
  assert.equal(vodWithoutTitle.response.needsClarification, true);
  const named = execute(call("get_navigation_route", {
    question: "Watch Horizon", goal: "watch", itemKind: "content", itemId: "horizon",
  })).response;
  assert.equal(named.requestedItem.id, "horizon");
  assert.equal(named.itemSelection.screenId, "vod");
  assert.equal(named.itemSelection.control.id, "SELECT_CONTENT");
  assert.ok(named.steps.some((step) => step.toScreen === "vod"));
  assert.equal(named.steps.at(-1).action, "SELECT_CONTENT");
});

test("navigation validates and returns an exact requested title", () => {
  const execute = createAssistantTools("home.png");
  const response = execute(call("get_navigation_route", {
    question: "Watch the horizon title",
    targetScreen: "content_details",
    itemKind: "content",
    itemId: "horizon",
  })).response;
  assert.equal(response.requestedItem.id, "horizon");
  assert.ok(response.requestedItem.name);
  assert.throws(() => execute(call("get_navigation_route", {
    question: "Watch missing title",
    targetScreen: "content_details",
    itemKind: "content",
    itemId: "missing",
  })), /Unknown access target/);
});

test("navigation returns actual controls even when already on the destination page", () => {
  const execute = createAssistantTools("packages.png");
  const { response } = execute(
    call("get_navigation_route", {
      question: "How do I change my subscription?",
      targetScreen: "packages",
    }),
  );
  assert.deepEqual(response.steps, []);
  assert.ok(response.destinationOptions.some(({ action }) => action === "SELECT_SUBSCRIPTION"));
  assert.ok(response.contextLimitations);
  const audio = execute(
    call("get_navigation_route", {
      question: "Which audio languages can I choose?",
      targetScreen: "audio_options",
    }),
  );
  assert.deepEqual(
    audio.response.destinationOptions.find(({ action }) => action === "SELECT_AUDIO").choices,
    ["עברית", "English"],
  );
});

test("an unavailable personal destination is not reported as successful navigation", () => {
  const execute = createAssistantTools("account.png", {
    getUser: () => ({ library: { recordings: [] }, billing: { invoices: [] } }),
  });
  const output = execute(
    call("get_navigation_route", {
      question: "Open a recording",
      targetScreen: "recording_details",
    }),
  );
  assert.equal(output.result.success, false);
  assert.equal(output.response.success, false);
  assert.deepEqual(output.response.steps, []);
});

test("account tools return only requested fields and source-backed cards", () => {
  const execute = createAssistantTools("home.png", { getUser: () => demoAccountTemplate });
  const output = execute(
    call("get_account_information", {
      question: "What is my name?",
      category: "profile",
      fields: ["displayName"],
    }),
  );
  assert.deepEqual(output.response.information, {
    displayName: accountInformationForCategory("profile", demoAccountTemplate).displayName,
  });
  assert.deepEqual(
    output.result.presentation.cards.map((card) => card.id),
    ["displayName"],
  );
  assert.ok(!JSON.stringify(output).includes("customerNumber"));
  const plan = execute(
    call("get_account_information", {
      question: "How much is my plan?",
      category: "subscription",
      fields: ["planName", "monthlyPrice"],
    }),
  );
  assert.deepEqual(Object.keys(plan.response.information), ["planName", "monthlyPrice"]);
  assert.equal(plan.result.presentation.cards.length, 1);
  assert.equal(plan.result.presentation.cards[0].facts.length, 1);
  assert.ok(!JSON.stringify(plan).includes("addOns"));
});

test("billing uses the requested source statement and never substitutes an unavailable month", () => {
  const execute = createAssistantTools("home.png", { getUser: () => demoAccountTemplate });
  const fields = ["invoices", "currency"];
  const selected = accountInformationForCategory("billing", demoAccountTemplate).invoices.filter(
    (invoice) => invoice.id === "2026-09",
  );
  assert.ok(selected.length);
  const output = execute(
    call("get_account_information", {
      question: "Show my September 2026 bill",
      category: "billing",
      fields,
    }),
  );
  assert.deepEqual(output.response.information.invoices, selected);
  assert.deepEqual(output.result.presentation.invoices, selected);
  const missing = execute(
    call("get_account_information", {
      question: "My bill for January 2020",
      category: "billing",
      fields,
    }),
  );
  assert.deepEqual(missing.response.information.invoices, []);
  assert.deepEqual(missing.result.presentation.invoices, []);
  const all = execute(
    call("get_account_information", {
      question: "אני רוצה לבדוק את כל החשבוניות שלי",
      category: "billing",
      fields,
    }),
  );
  assert.deepEqual(
    all.response.information.invoices.map((invoice) => invoice.id).sort(),
    demoAccountTemplate.billing.invoices.map((invoice) => invoice.id).sort(),
  );
});

test("website tools can retrieve exact record IDs and reject private or unsupported sections", () => {
  const execute = createAssistantTools("home.png", { getUser: () => demoAccountTemplate });
  const apps = publicInformationForCategory("apps");
  const output = execute(
    call("get_website_information", {
      question: "Tell me about this app",
      category: "apps",
      recordIds: [String(apps[0].id)],
    }),
  );
  assert.deepEqual(output.response.information, [apps[0]]);
  assert.equal(output.result.presentation.cards.length, 1);
  const channels = execute(
    call("get_website_information", {
      question: "What is on now?",
      category: "channels",
    }),
  );
  assert.match(channels.response.note, /dated demo schedule, not live TV listings/);
  assert.throws(
    () =>
      execute(
        call("get_website_information", {
          question: "All data",
          category: "assets",
        }),
      ),
    /Unknown website category/,
  );
  assert.throws(
    () =>
      execute(
        call("get_account_information", {
          question: "All data",
          category: "id",
          fields: ["id"],
        }),
      ),
    /Unknown account category/,
  );
  assert.throws(
    () =>
      execute(
        call("get_account_information", {
          question: "Name",
          category: "profile",
          fields: ["__proto__"],
        }),
      ),
    /Unknown field/,
  );
  assert.throws(
    () =>
      execute(
        call("get_account_information", {
          question: "Name",
          category: "profile",
        }),
      ),
    /Invalid fields/,
  );
  assert.throws(
    () =>
      execute(
        call("get_navigation_route", {
          question: "Go",
          targetScreen: "invented",
        }),
      ),
    /Unknown destination/,
  );
  assert.throws(() => execute(call("delete_account", { question: "Delete" })), /Unknown Nova tool/);
});

test("display selection ignores invented cards and snapshots are isolated between sessions", () => {
  const execute = createAssistantTools("home.png", { getUser: () => demoAccountTemplate });
  const output = execute(
    call("get_account_information", {
      question: "My plan",
      category: "subscription",
      fields: ["planName", "addOns"],
    }),
  );
  const narrowed = execute(
    call(
      "show_information_cards",
      { lookupId: output.response.lookupId, displayIds: ["plan", "invented"] },
      "display",
    ),
  );
  assert.deepEqual(
    narrowed.result.presentation.cards.map((card) => card.id),
    ["plan"],
  );
  assert.throws(
    () =>
      createAssistantTools("home.png", { getUser: () => demoAccountTemplate })(
        call("show_information_cards", {
          lookupId: "lookup",
          displayIds: ["plan"],
        }),
      ),
    /no longer available/,
  );
});

test("library labels and notifications work with selected account fields", () => {
  const execute = createAssistantTools("home.png", { getUser: () => demoAccountTemplate });
  const library = execute(
    call("get_account_information", {
      question: "My favorites",
      category: "library",
      fields: ["favoriteContentIds"],
    }),
  );
  assert.ok(Object.keys(library.response.publicLabels.contentTitles).length > 0);
  assert.deepEqual(library.response.publicLabels.channelNames, {});
  assert.ok(!JSON.stringify(library.response.information).includes("watchProgress"));
  const notifications = execute(
    call("get_account_information", {
      question: "My notifications",
      category: "notifications",
      fields: ["items"],
    }),
  );
  assert.deepEqual(
    notifications.response.information.items,
    accountInformationForCategory("notifications", demoAccountTemplate),
  );
});

test("catalog includes field names but no account values, and backend has no content-generation calls", () => {
  const catalog = toolCatalog();
  assert.ok(catalog.account.find((item) => item.id === "profile").fields.includes("displayName"));
  assert.ok(
    !JSON.stringify(catalog).includes(
      accountInformationForCategory("profile", demoAccountTemplate).customerNumber,
    ),
  );
  const sourceFiles = readdirSync(new URL("../src/", import.meta.url), {
    recursive: true,
  }).filter((name) => name.endsWith(".js"));
  for (const file of sourceFiles) {
    assert.doesNotMatch(
      readFileSync(new URL(`../src/${file.replaceAll("\\", "/")}`, import.meta.url), "utf8"),
      /generateContent|GEMMA_MODEL/,
    );
  }
});
