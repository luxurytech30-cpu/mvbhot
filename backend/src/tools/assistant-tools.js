import {
  screenCatalog,
  screenFromImageName,
  pageControlsFor,
  buildNavigationRoute,
} from "../navigation/navigation-routes.js";
import { pageInformation, requestedCatalogItem } from "../navigation/page-information.js";
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

const watchTargets = {
  content: { parent: "vod", destination: "content_details", control: "SELECT_CONTENT", collection: "items" },
  channel: { parent: "channels", destination: "channel_details", control: "SELECT_CHANNEL", collection: "channels" },
  program: { parent: "tv_guide", destination: "program_details", control: "SELECT_PROGRAM" },
};

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
      if (args.goal === "watch" && args.itemKind && !args.itemId) {
        result.needsClarification = true;
        return { result, response: { lookupId, needsClarification: true,
          clarification: args.itemKind === "channel"
            ? "Ask which channel they want to watch."
            : "Ask for the title they want to watch." } };
      }
      if (Boolean(args.itemKind) !== Boolean(args.itemId))
        throw new Error("Unknown access target");
      if (args.goal === "watch" && !args.itemKind) {
        result.needsClarification = true;
        return { result, response: {
          lookupId,
          needsClarification: true,
          clarification: "Ask whether they want a VOD title or a live channel, and which title or channel. If the kind is already clear, ask only for the missing name.",
          choices: ["VOD title", "live channel"],
        } };
      }
      if (args.goal === "watch" && args.itemKind && !watchTargets[args.itemKind]) {
        result.needsClarification = true;
        return { result, response: {
          lookupId,
          needsClarification: true,
          clarification: "Ask which VOD title, live channel, or guide program they want to watch.",
        } };
      }
      let controlTarget = null;
      if (args.goal === "open_control" && args.controlDescription && !args.targetScreen) {
        const context = getContext();
        const screenId = screenFromImageName(context?.imageName || imageName);
        const page = pageInformation({
          screenId, route: context?.path, account: getUser(), uiState: context?.uiState,
          reported: Boolean(context), controlDescription: args.controlDescription,
        });
        if (page.controlMatch?.status !== "matched" || !page.controlMatch.control.targetScreen) {
          result.needsClarification = true;
          return { result, response: {
            lookupId, needsClarification: true, currentScreen: page.screenId,
            controlMatch: page.controlMatch,
            clarification: page.controlMatch?.status === "ambiguous"
              ? "Several documented controls fit. Ask which one the user means."
              : "That control is not documented on this page. Ask for its name or describe what is on the page.",
          } };
        }
        controlTarget = page.controlMatch.control.targetScreen;
      }
      const requestedItem = args.itemKind
        ? requestedCatalogItem(args.itemKind, args.itemId)
        : null;
      const watchTarget = args.goal === "watch" ? watchTargets[args.itemKind] : null;
      const targetScreen = watchTarget?.destination || controlTarget || args.targetScreen;
      if (!targetScreen) {
        result.needsClarification = true;
        return { result, response: { lookupId, needsClarification: true,
          clarification: "Ask which page or button the user means." } };
      }
      if (!screenCatalog.some((item) => item.id === targetScreen))
        throw new Error("Unknown destination");
      let itemSelection = null;
      if (watchTarget) {
        const parentControls = pageControlsFor(watchTarget.parent, getUser());
        const control = parentControls.find((candidate) => candidate.id === watchTarget.control);
        if (!control || control.targetScreen !== watchTarget.destination)
          throw new Error("Unknown access target");
        if (watchTarget.collection) {
          const page = pageInformation({ screenId: watchTarget.parent,
            account: getUser(), reported: false });
          if (!page.content[watchTarget.collection]?.some((item) => item.id === requestedItem.id))
            throw new Error("Unknown access target");
        }
        itemSelection = { screenId: watchTarget.parent, control, item: requestedItem,
          note: "This is a documented catalog match, not confirmation that the item is currently visible or selected." };
      }
      const context = getContext();
      const currentScreen = screenFromImageName(context?.imageName || imageName);
      const alreadyOnItem = watchTarget && currentScreen === targetScreen &&
        context?.path?.split("?")[0].split("/").at(-1) === requestedItem.id;
      const route = buildNavigationRoute({
        imageName: context?.imageName || imageName,
        targetScreen,
        viaScreen: alreadyOnItem ? null : watchTarget?.parent,
        userIntent: args.question,
        account: getUser(),
        uiState: context?.uiState,
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
          requestedItem,
          itemSelection,
          steps: route.steps,
          instruction: route.finalInstruction,
          destinationOptions: route.destinationOptions,
          contextLimitations: route.contextLimitations,
        },
      };
    }
    if (call.name === "get_page_information") {
      const context = getContext();
      const screenId = args.screenId ||
        screenFromImageName(context?.imageName || imageName);
      const information = pageInformation({
        screenId,
        route: args.screenId ? null : context?.path,
        account: getUser(),
        uiState: args.screenId ? null : context?.uiState,
        reported: !args.screenId && Boolean(context),
        controlDescription: args.controlDescription,
      });
      return { result, response: { lookupId, ...information } };
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
          "Stored account data; missing values are unavailable. Answer only the question using the relevant fields. Do not claim that the account was changed.",
      },
    };
  };
}
