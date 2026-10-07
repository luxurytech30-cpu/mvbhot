import {
  screenCatalog,
  screenFromImageName,
  buildNavigationRoute,
} from "../navigation/navigation-routes.js";
import {
  publicCategoryCatalog,
  publicInformationForCategory,
} from "../information/public-catalog.js";
import {
  accountCategoryCatalog,
  accountInformationForCategory,
  accountPublicLabels,
} from "../accounts/account-information.js";
import { billingForQuestion } from "../presentation/invoice-selection.js";
import { buildPresentation } from "../presentation/answer-presentation.js";
import { informationCards, userCards } from "../presentation/information-cards.js";

// Only known, static errors may appear in logs or provider responses. Never expose
// raw persistence/provider exceptions, account values, or tool arguments.
export function toolErrorDetails(error) {
  const messages = {
    "Invalid tool arguments": "INVALID_ARGUMENTS",
    "Invalid fields": "INVALID_FIELDS",
    "Invalid recordIds": "INVALID_RECORD_IDS",
    "Invalid displayIds": "INVALID_DISPLAY_IDS",
    "Unknown field in the selected category": "UNKNOWN_FIELD",
    "A valid question is required": "INVALID_QUESTION",
    "Sign in to access personal information": "SIGN_IN_REQUIRED",
    "Session expired": "SESSION_EXPIRED",
    "Account unavailable": "ACCOUNT_UNAVAILABLE",
    "Unknown access target": "UNKNOWN_ACCESS_TARGET",
    "Unknown destination": "UNKNOWN_DESTINATION",
    "Unknown website category": "UNKNOWN_WEBSITE_CATEGORY",
    "Unknown account category": "UNKNOWN_ACCOUNT_CATEGORY",
    "recordIds requires an array category": "INVALID_RECORD_FILTER",
    "Lookup is no longer available; retrieve the information again": "LOOKUP_EXPIRED",
    "displayIds is required": "MISSING_DISPLAY_IDS",
    "Unknown Nova tool": "UNKNOWN_TOOL",
  };
  const message = error?.message;
  return message && Object.hasOwn(messages, message)
    ? { code: messages[message], error: message }
    : { code: "TOOL_EXECUTION_FAILED", error: "The requested information could not be retrieved" };
}

function strings(value, name, required = false) {
  if (value === undefined && !required) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((item) => typeof item !== "string" || item.length > 200) ||
    (required && !value.length)
  )
    throw new Error(`Invalid ${name}`);
  return [...new Set(value)];
}

function selectFields(info, fields) {
  if (!fields) return info;
  if (
    !info ||
    Array.isArray(info) ||
    typeof info !== "object" ||
    fields.some((field) => !Object.hasOwn(info, field))
  )
    throw new Error("Unknown field in the selected category");
  return Object.fromEntries(fields.map((field) => [field, info[field]]));
}

export function createAssistantTools(
  imageName,
  { getUser = () => null, getContext = () => null } = {},
) {
  screenFromImageName(imageName);
  const snapshots = new Map();
  return function execute(call) {
    const args = call.args;
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error("Invalid tool arguments");
    if (call.name === "show_information_cards") {
      const snapshot = snapshots.get(args.lookupId);
      if (!snapshot)
        throw new Error("Lookup is no longer available; retrieve the information again");
      const ids = strings(args.displayIds, "displayIds");
      if (!ids) throw new Error("displayIds is required");
      const result = {
        ...snapshot.result,
        presentation: {
          ...snapshot.result.presentation,
          cards: snapshot.cards.filter((card) => ids.includes(card.id)).slice(0, 8),
        },
      };
      return {
        result,
        response: {
          displayed: result.presentation.cards.map((card) => card.id),
        },
      };
    }
    if (typeof args.question !== "string" || !args.question.trim() || args.question.length > 8000)
      throw new Error("A valid question is required");
    const lookupId = String(call.id);
    const result = {
      success: true,
      lookupId,
      type: "answer",
      transcript: args.question,
      currentScreen: null,
      targetScreen: null,
      steps: [],
      answer: "",
      presentation: null,
    };
    let information;
    let cards = [];
    let labels;
    if (call.name === "get_account_access") {
      const user = getUser();
      if (!user) throw new Error("Sign in to access personal information");
      const field = {
        channel: "channels",
        content: "content",
        library: "libraries",
        program: "programs",
      }[args.kind];
      information = field && user.access[field].find((item) => item.id === args.id);
      if (!information) throw new Error("Unknown access target");
      result.type = "user_data";
      cards = [
        {
          id: information.id,
          title: information.title,
          facts: [{ label: "גישה לצפייה", value: information.allowed ? "פתוח" : "נעול" }],
        },
      ];
      result.presentation = buildPresentation({
        category: "access",
        source: "user",
        cards,
        displayIds: [information.id],
      });
      snapshots.set(lookupId, { result, cards });
      if (snapshots.size > 12) snapshots.delete(snapshots.keys().next().value);
      return {
        result,
        response: {
          lookupId,
          information,
          availableCards: cards.map(({ id, title }) => ({ id, title })),
          note: "Current account authorization. Purchase options are guidance only; Nova cannot purchase, cancel or operate the TV. The customer confirms purchases in the TV UI.",
        },
      };
    }
    if (call.name === "get_navigation_route") {
      if (!screenCatalog.some((item) => item.id === args.targetScreen))
        throw new Error("Unknown destination");
      const route = buildNavigationRoute({
        imageName: getContext()?.imageName || imageName,
        targetScreen: args.targetScreen,
        userIntent: args.question,
        account: getUser(),
      });
      Object.assign(result, {
        success: route.success,
        type: "navigation",
        currentScreen: route.currentScreen,
        targetScreen: route.targetScreen,
        steps: route.steps,
      });
      return {
        result,
        response: {
          lookupId,
          success: route.success,
          currentScreen: route.currentScreen,
          targetScreen: route.targetScreen,
          targetScreenName: route.targetScreenName,
          targetScreenDescription: route.targetScreenDescription,
          steps: route.steps,
          instruction: route.finalInstruction,
          destinationOptions: route.destinationOptions,
          contextLimitations: route.contextLimitations,
        },
      };
    }
    if (call.name === "get_website_information") {
      if (!publicCategoryCatalog.some((item) => item.id === args.category))
        throw new Error("Unknown website category");
      information = publicInformationForCategory(args.category);
      const ids = strings(args.recordIds, "recordIds");
      if (ids) {
        if (!Array.isArray(information)) throw new Error("recordIds requires an array category");
        information = information.filter((item) => ids.includes(String(item.id)));
      }
      information = selectFields(information, strings(args.fields, "fields"));
      cards = informationCards(information);
      result.presentation = buildPresentation({
        category: args.category,
        source: "website",
        cards,
        displayIds: cards.map((card) => card.id),
      });
    } else if (call.name === "get_account_information") {
      if (!accountCategoryCatalog.some((item) => item.id === args.category))
        throw new Error("Unknown account category");
      const user = getUser();
      if (!user) throw new Error("Sign in to access personal information");
      const source =
        args.category === "billing"
          ? billingForQuestion(args.question, user.billing)
          : accountInformationForCategory(args.category, user);
      const selected = Array.isArray(source) ? { items: source } : source;
      information = selectFields(selected, strings(args.fields, "fields", true));
      labels = accountPublicLabels(args.category, information);
      cards = userCards(args.category, information);
      result.type = "user_data";
      result.presentation = buildPresentation({
        category: args.category,
        source: "user",
        cards,
        displayIds: cards.map((card) => card.id),
        invoices: args.category === "billing" ? information?.invoices || [] : [],
      });
    } else throw new Error("Unknown Nova tool");
    snapshots.set(lookupId, { result, cards });
    if (snapshots.size > 12) snapshots.delete(snapshots.keys().next().value);
    return {
      result,
      response: {
        lookupId,
        category: args.category,
        information,
        publicLabels: labels,
        availableCards: cards.map(({ id, title }) => ({ id, title })),
        note:
          (call.name === "get_website_information" &&
          ["channels", "programs", "guide"].includes(args.category)
            ? "This is a dated demo schedule, not live TV listings. Do not say a program is airing now unless a live source confirms it. "
            : "") +
          "Stored demo data; missing values are unavailable. Answer only the question using the relevant fields. Do not claim that the account was changed.",
      },
    };
  };
}
