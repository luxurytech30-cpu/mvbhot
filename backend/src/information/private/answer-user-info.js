import { ai, answerModel } from "../../ai/ai-models.js";
import { publicLabelsForUserCategory, userInformationForCategory } from "./user-info.js";
import { billingForQuestion, buildPresentation, userCards } from "../answer-presentation.js";
import { timedAction } from "../../action-timer.js";

export async function answerUserInfo({ message, category }, runAction = timedAction) {
  const information = await runAction("Select user data", () =>
    category === "billing" ? billingForQuestion(message) : userInformationForCategory(category));
  const labels = await runAction("Resolve user data labels", () => publicLabelsForUserCategory(category));
  const cards = await runAction("Prepare user display cards", () => userCards(category));
  const prompt = `You are Nova, a helpful TV assistant. Answer the user's question about their own NOVA TV demo account clearly and concisely in the user's language. Return only JSON: {"answer":"...","displayIds":["relevant card id"]}. Write natural, friendly sentences. Select only cards that help answer this specific question from the available display cards; use [] when none are relevant. Do not invent IDs or expose unrelated profile fields. For billing, the supplied invoices are already selected for the question and will be displayed with your answer. If there are no matching invoices, say that the requested bill is unavailable.

Use only the selected user data below. For library IDs, you may use the supplied public labels to say the title or channel name. If the requested personal fact is missing, say it is unavailable; do not guess or substitute general catalog data. Do not reveal unrelated personal details or the entire user record. Do not claim that the data is live or that you changed the account. Do not include navigation steps unless the user asked how to reach a screen.

User message: ${JSON.stringify(message)}
Selected user category: ${JSON.stringify(category)}
Selected user data: ${JSON.stringify(information)}
Public labels for selected IDs: ${JSON.stringify(labels)}
Available display cards: ${JSON.stringify(cards.map(card => ({ id: card.id, title: card.title })))}`;

  const response = await runAction("Generate user answer", () => ai.models.generateContent({
    model: answerModel,
    contents: prompt,
    config: { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } },
  }));
  const parsed = JSON.parse(response.text);
  const result = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  if (typeof result?.answer !== "string" || !result.answer.trim()) {
    throw new Error("Gemma returned an empty user information answer");
  }
  const presentation = await runAction("Prepare user presentation", () => buildPresentation({
    category, source: "user", cards, displayIds: result.displayIds,
    invoices: category === "billing" ? information?.invoices || [] : [],
  }));
  return {
    answer: result.answer.trim(),
    presentation,
  };
}
