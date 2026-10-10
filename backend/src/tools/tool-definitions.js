import { screenCatalog } from "../navigation/navigation-routes.js";
import {
  publicCategoryCatalog,
  publicInformationForCategory,
} from "../information/public-catalog.js";
import {
  accountCategoryCatalog,
  accountInformationForCategory,
} from "../accounts/account-information.js";
import { demoAccountTemplate } from "../accounts/demo-accounts.js";
import { catalog } from "../information/catalog-data.js";

const string = (description) => ({ type: "STRING", description });
const list = (description) => ({
  type: "ARRAY",
  items: { type: "STRING" },
  description,
});
const declaration = (name, description, properties, required) => ({
  name,
  description,
  behavior: "NON_BLOCKING",
  parameters: { type: "OBJECT", properties, required },
});

export const toolDeclarations = [
  declaration(
    "get_account_access",
    "Check whether a channel, VOD title, library or CatchUp program is open for the signed-in account, why it is locked, and exact purchase options. Use before saying a title/channel is included or suggesting a purchase. This reads data and never buys or cancels.",
    {
      kind: {
        ...string("Type of access to check."),
        enum: ["channel", "content", "library", "program"],
      },
      id: string("Exact public catalog ID for the requested record."),
      question: string("The user's complete question."),
    },
    ["kind", "id", "question"],
  ),
  declaration(
    "get_navigation_route",
    "Resolve a navigation goal from the latest TV screen. For watch goals, supply known itemKind/itemId; vague goals return a clarification instead of a generic route. For a described button, supply controlDescription. This does not operate the TV.",
    {
      targetScreen: {
        ...string("Optional exact destination for a known page goal. Omit for a vague watch goal or described control."),
        enum: screenCatalog.map((item) => item.id),
      },
      goal: {
        ...string("What the user wants to do. Use watch for requests to watch a title or channel, even if the title is missing."),
        enum: ["navigate", "watch", "open_control"],
      },
      controlDescription: string("The user's words describing a button, icon, or its position; use with open_control."),
      question: string(
        "The user's complete navigation request, with relevant conversation context.",
      ),
      itemKind: {
        ...string("Optional kind of exact requested catalog item. Supply with itemId when known."),
        enum: ["content", "channel", "program", "app", "library"],
      },
      itemId: string("Optional exact catalog ID of the requested title, channel, program, app, or library."),
    },
    ["question"],
  ),
  declaration(
    "get_page_information",
    "Get documented controls and catalog items for the current TV page, or another named page. Use to answer what is on a page or to identify the exact item/control in a navigation request. The current page route and open menu/dialog are reported by the TV; other controls are documented possibilities, not verified focus or selection.",
    {
      question: string("The user's complete question."),
      screenId: {
        ...string("Optional page to inspect. Omit to inspect the latest reported TV page."),
        enum: screenCatalog.map((item) => item.id),
      },
      controlDescription: string("Optional words describing a button or icon. Returns the matching documented control or possible matches."),
    },
    ["question"],
  ),
  declaration(
    "get_website_information",
    "Read a selected category of NOVA TV site data. Use only for site-specific facts; general explanations need no tool.",
    {
      category: {
        ...string("The relevant website category."),
        enum: publicCategoryCatalog.map((item) => item.id),
      },
      question: string("The user's complete question."),
      fields: list(
        "Optional top-level fields for object categories, from the catalog. Omit to read the selected category.",
      ),
      recordIds: list(
        "Optional exact IDs to retrieve from array categories. Omit when listing or when the IDs are unknown.",
      ),
    },
    ["category", "question"],
  ),
  declaration(
    "get_account_information",
    "Read ONLY the relevant fields from one account category. Bills are selected locally for the question. Never use this to change an account.",
    {
      category: {
        ...string("The relevant account category."),
        enum: accountCategoryCatalog.map((item) => item.id),
      },
      question: string(
        "The user's complete question, including a requested month, year, or invoice reference.",
      ),
      fields: list(
        "Required: only the relevant field names from the account field catalog. For bills include invoices and currency; for plan questions planName and monthlyPrice.",
      ),
    },
    ["category", "question", "fields"],
  ),
  declaration(
    "show_information_cards",
    "Optional: narrow the displayed cards after a lookup. Use known card IDs from its response. Does not delay or generate the spoken answer.",
    {
      lookupId: string("The lookupId returned by the data tool."),
      displayIds: list(
        "Only relevant card IDs returned by that lookup; [] hides its cards. Bills remain available.",
      ),
    },
    ["lookupId", "displayIds"],
  ),
];

export function toolCatalog() {
  return {
    records: {
      content: catalog.content.filter((item) => item.vod).map(({ id, title }) => ({ id, title })),
      channels: catalog.channels.map(({ id, name }) => ({ id, name })),
      libraries: catalog.libraries.map(({ id, name }) => ({ id, name })),
      apps: catalog.apps.map(({ id, name }) => ({ id, name })),
      programs: catalog.programs.map(({ id, contentId, channelId }) => ({
        id,
        contentId,
        channelId,
      })),
    },
    screens: screenCatalog.map(({ id, name }) => ({ id, name })),
    website: publicCategoryCatalog.map((item) => {
      const info = publicInformationForCategory(item.id);
      return {
        ...item,
        fields:
          info && !Array.isArray(info) && typeof info === "object" ? Object.keys(info) : undefined,
      };
    }),
    account: accountCategoryCatalog.map((item) => ({
      ...item,
      fields: Array.isArray(accountInformationForCategory(item.id, demoAccountTemplate))
        ? ["items"]
        : Object.keys(accountInformationForCategory(item.id, demoAccountTemplate) || {}),
    })),
  };
}
