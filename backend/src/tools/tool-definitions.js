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
    "Get the exact shortest TV route and available destination controls from the signed-in customer's latest reported TV screen. Use for how-to questions about buttons, settings and navigation, even when already on that page. This provides instructions; it does not operate the TV.",
    {
      targetScreen: {
        ...string("Choose an exact destination from the screen catalog."),
        enum: screenCatalog.map((item) => item.id),
      },
      question: string(
        "The user's complete navigation request, with relevant conversation context.",
      ),
    },
    ["targetScreen", "question"],
  ),
  declaration(
    "get_website_information",
    "Read a selected category of NOVA TV demo website data. Use only for site-specific facts; general explanations need no tool.",
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
    "Read ONLY the relevant fields from one demo account category. Bills are selected locally for the question. Never use this to change an account.",
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
