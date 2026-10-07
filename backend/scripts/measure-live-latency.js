import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { createGeminiLiveConfig, geminiLiveModel } from "../src/live/gemini-live-config.js";
import { interactionStatus } from "../src/live/live-conversation.js";
import { createAssistantTools } from "../src/tools/assistant-tools.js";

// Public navigation benchmark. Text input isolates tool/model delay from microphone/VAD delay.
const question = process.argv[2] || "How do I open Settings from the Home screen?";
const execute = createAssistantTools("home.png");
const model = geminiLiveModel();
let session;
let started;
let toolReturned;
let firstAudio;
let firstAudioAfterTool;
let spokenText = "";
const tools = [];
let settled = false;
let finish;
const done = new Promise((resolve) => {
  finish = resolve;
});
const complete = (reason) => {
  if (settled) return;
  settled = true;
  console.log(
    JSON.stringify({
      version: "live-with-direct-tools",
      question,
      reason,
      firstAudioMs: firstAudio,
      firstAudioAfterToolMs: firstAudioAfterTool,
      tools,
      totalMs: started ? performance.now() - started : null,
      spokenText,
    }),
  );
  finish();
};
const timer = setTimeout(() => complete("timeout"), 45000);
try {
  session = await new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { apiVersion: "v1alpha" },
  }).live.connect({
    model,
    config: createGeminiLiveConfig(),
    callbacks: {
      onerror: () => complete("provider-error"),
      onclose: () => complete("connection-closed"),
      onmessage: (message) => {
        if (settled || !started) return;
        spokenText += message.serverContent?.outputTranscription?.text || "";
        if (
          message.serverContent?.modelTurn?.parts?.some((part) =>
            part.inlineData?.mimeType?.startsWith("audio/pcm"),
          )
        ) {
          firstAudio ??= performance.now() - started;
          if (toolReturned) firstAudioAfterTool ??= performance.now() - started;
        }
        for (const call of message.toolCall?.functionCalls || []) {
          const at = performance.now();
          let response;
          try {
            response = execute(call).response;
          } catch (error) {
            response = { error: error.message };
          }
          tools.push({
            name: call.name,
            durationMs: performance.now() - at,
            success: !response.error,
          });
          session.sendToolResponse({
            functionResponses: [{ id: call.id, name: call.name, response }],
          });
          if (call.name !== "show_information_cards") toolReturned = performance.now();
        }
        if (
          (interactionStatus(message) === "IDLE" ||
            (model === "gemini-3.8-live" && message.serverContent?.turnComplete)) &&
          firstAudio !== undefined &&
          toolReturned
        )
          complete("complete");
      },
    },
  });
  if (!settled) {
    started = performance.now();
    session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: question }] }],
      turnComplete: true,
    });
    await done;
  }
} catch {
  complete("setup-error");
} finally {
  clearTimeout(timer);
  session?.close();
}
