import { ai, answerModel } from "../../ai/ai-models.js";
import { informationForCategory } from "./general-info.js";
import { buildPresentation, informationCards } from "../answer-presentation.js";
import { timedAction } from "../../action-timer.js";

export async function answerInformation({ message, category }, runAction = timedAction) {
  const information = await runAction("Select website data", () => category ? informationForCategory(category) : null);
  const cards = await runAction("Prepare website display cards", () => informationCards(information));
  const prompt = `You are Nova, a helpful TV assistant. Answer the user's information question clearly and concisely in the user's language. Write natural, friendly sentences. Return only JSON: {"answer":"...","displayIds":["relevant card id"]}. Select the cards that help answer this specific question from the available display cards. Use [] for a general question with no relevant source cards. Do not invent card IDs.

Use the selected NOVA TV information section when relevant. If the question asks for specific NOVA TV facts that are not present there, say that the information is unavailable rather than guessing. You may explain general TV concepts. Do not claim to know live schedules, subscriptions, account details, or device-specific features without evidence. Do not include navigation steps or claim to see the user's screen.

User message: ${JSON.stringify(message)}
Selected information category: ${JSON.stringify(category)}
Selected information: ${JSON.stringify(information)}
Available display cards: ${JSON.stringify(cards.map(card => ({ id: card.id, title: card.title })))}`;
  const response = await runAction("Generate website answer", () => ai.models.generateContent({
    model: answerModel,
    contents: prompt,
    config: { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } },
  }));
  const parsed = JSON.parse(response.text);
  const result = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  if (typeof result?.answer !== "string" || !result.answer.trim()) {
    throw new Error("Gemma returned an empty information answer");
  }
  const presentation = await runAction("Prepare website presentation", () =>
    buildPresentation({ category, source: "website", cards, displayIds: result.displayIds }));
  return { answer: result.answer.trim(), presentation };
}
