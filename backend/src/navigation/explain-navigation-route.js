import { ai, answerModel } from "../ai/ai-models.js";

export async function explainNavigationRoute({ message, route }) {
  if (!route.success || route.steps.length === 0) return route.finalInstruction;

  const context = {
    request: message,
    currentScreen: route.currentScreen,
    destination: route.targetScreenName,
    steps: route.steps.map(step => ({
      location: step.location,
      actions: step.instructions,
      result: step.expectedResult,
    })),
  };
  const prompt = `You are Nova, a helpful TV assistant speaking naturally to one person in Hebrew. Return only JSON: {"answer":"..."}. Turn the route data into a short, conversational answer. Weave each control's location into the action instead of listing data fields. Keep the physical actions and their order, but paraphrase freely for natural Hebrew. For a single step, use one or two sentences without a list or a heading. Mention what opens afterward only if useful. Never say "התוצאה הצפויה", "מיקום", "שלב הבא", or repeat the same control name unnecessarily. Do not invent button locations or actions. Example style: "במסך הבית, חפשו למעלה את סמל גלגל השיניים. בחרו בו ולחצו OK כדי לפתוח את ההגדרות."\n\nRoute data: ${JSON.stringify(context)}`;
  const response = await ai.models.generateContent({
    model: answerModel,
    contents: prompt,
    config: { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } },
  });
  const parsed = JSON.parse(response.text);
  const result = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  if (typeof result?.answer !== "string" || !result.answer.trim()) {
    throw new Error("Gemma returned an empty route explanation");
  }
  return result.answer.trim();
}
