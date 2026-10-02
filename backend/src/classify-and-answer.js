import { ai, answerModel } from "./ai/ai-models.js";
import { screenCatalog } from "./navigation/find-navigation-route.js";
import { informationCategoryCatalog } from "./information/general/general-info.js";
import { userInformationCategoryCatalog } from "./information/private/user-info.js";

// Select the destination, general information section, or user data section in one model request.
export async function classifyRequest(message, imageName) {
  const prompt = `You are Nova, a TV assistant. Classify the user's request and return JSON only.

Choose "navigation" when the user wants to get somewhere in the TV interface, open an app or channel, change a setting, or asks how to perform an action. A question such as "How do I find sports?" is navigation. Return {"type":"navigation","targetScreen":"exact screen id or null","userIntent":"brief interpretation of the request in Hebrew"}. Choose the best destination from the screen catalog. If it is unclear or missing, use null. Do not invent a screen.

Choose "answer" when the user wants an explanation, definition, or other information without screen actions. Return {"type":"answer","category":"exact information category id or null"}. Pick the section of the information file most relevant to answering the question. Use null for a general question unrelated to the supplied data. Do not answer the question in this request.

Choose "user_data" when the user asks about their own account or data, such as their name, current plan, bill, settings preferences, favorites, recordings, viewing progress, or notifications. Return {"type":"user_data","category":"exact user information category id or null"}. Choose the relevant section from the user information category catalog. Do not answer the question or invent account facts. For example, "What is my plan?" is user_data, while "What plans are available?" is answer. "How do I open my bill?" is navigation, while "How much is my bill?" is user_data.

The selected screen is provided as an image filename only; the image itself is not available.
Selected screen image filename: ${JSON.stringify(imageName || "")}
User message: ${JSON.stringify(message)}
Screen catalog: ${JSON.stringify(screenCatalog)}
Information categories: ${JSON.stringify(informationCategoryCatalog)}
User information categories: ${JSON.stringify(userInformationCategoryCatalog)}`;

  const response = await ai.models.generateContent({
    model: answerModel,
    contents: prompt,
    config: { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } },
  });

  const parsed = JSON.parse(response.text);
  const result = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  if (result?.type === "navigation") {
    const targetScreen = screenCatalog.some(screen => screen.id === result.targetScreen)
      ? result.targetScreen
      : null;
    return { type: "navigation", targetScreen, userIntent: result.userIntent || message };
  }
  if (result?.type === "answer") {
    const category = informationCategoryCatalog.some(item => item.id === result.category)
      ? result.category
      : null;
    return { type: "answer", category };
  }
  if (result?.type === "user_data") {
    const category = userInformationCategoryCatalog.some(item => item.id === result.category)
      ? result.category
      : null;
    return { type: "user_data", category };
  }
  throw new Error("Gemma returned an invalid request type");
}
