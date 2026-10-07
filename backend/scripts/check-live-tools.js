import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { createGeminiLiveConfig, geminiLiveModel } from "../src/live/gemini-live-config.js";
import { createAssistantTools, toolErrorDetails } from "../src/tools/assistant-tools.js";
import { createAccountStore } from "../src/accounts/account-store.js";
import { demoAccountTemplate } from "../src/accounts/demo-accounts.js";
import { interactionStatus } from "../src/live/live-conversation.js";

// A connection acknowledgment alone does not prove that tool calling works.
// Only synthetic in-memory accounts are used; saved accounts are never loaded.
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const model = option("model") || geminiLiveModel();
const minimal = process.argv.includes("--minimal");
const allInvoices = process.argv.includes("--all-invoices");
const config = createGeminiLiveConfig({ model });
if (option("behavior")) {
  for (const declaration of config.tools[0].functionDeclarations)
    declaration.behavior = option("behavior");
}
if (minimal) {
  config.systemInstruction =
    "Call diagnostic_echo when asked, then say its returned token. Do not invent a result.";
  config.tools = [
    {
      functionDeclarations: [
        {
          name: "diagnostic_echo",
          description: "Returns a harmless diagnostic token.",
          behavior: option("behavior") || "NON_BLOCKING",
          parameters: {
            type: "OBJECT",
            properties: { nonce: { type: "STRING" } },
            required: ["nonce"],
          },
        },
      ],
    },
  ];
}
const store = minimal ? null : createAccountStore({ file: null });
const execute = minimal
  ? null
  : createAssistantTools("account.png", {
      getUser: () => store.getUser(demoAccountTemplate.id),
    });
const question = minimal
  ? "Please call diagnostic_echo with nonce 237 now, then say the returned token."
  : allInvoices
    ? "אני רוצה לבדוק את כל החשבוניות שלי. הצג את כל החשבוניות הזמינות בחשבון."
    : "הראה לי את החשבונית שלי לאוקטובר 2026. בדוק באמצעות כלי החשבון והסבר את הסכום.";
let session,
  timer,
  started = false,
  settled = false,
  spokenText = "",
  audioReceived = false;
const tools = [];
let finish;
const done = new Promise((resolve) => {
  finish = resolve;
});
const complete = (reason) => {
  if (settled) return;
  settled = true;
  const expectedInvoices = allInvoices
    ? store.getUser(demoAccountTemplate.id).billing.invoices.map((invoice) => invoice.id)
    : [];
  const passed =
    reason === "complete" &&
    tools.some(
      (tool) =>
        tool.success &&
        tool.name === (minimal ? "diagnostic_echo" : "get_account_information") &&
        (!allInvoices || expectedInvoices.every((id) => tool.invoiceIds?.includes(id))),
    );
  console.log(JSON.stringify({ model, minimal, reason, passed, tools, spokenText }));
  process.exitCode = passed ? 0 : 1;
  finish();
};
timer = setTimeout(() => complete("timeout"), 45000);
try {
  session = await new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { apiVersion: "v1alpha" },
  }).live.connect({
    model,
    config,
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
        )
          audioReceived = true;
        for (const call of message.toolCall?.functionCalls || []) {
          let response;
          try {
            response = minimal ? { token: "ECHO_OK_237" } : execute(call).response;
          } catch (error) {
            response = toolErrorDetails(error);
          }
          tools.push({
            name: call.name,
            success: !response.error,
            code: response.code,
            invoiceIds: response.information?.invoices?.map((invoice) => invoice.id),
          });
          session.sendToolResponse({
            functionResponses: [{ id: call.id, name: call.name, response }],
          });
        }
        if (
          audioReceived &&
          (interactionStatus(message) === "IDLE" ||
            (model === "gemini-3.8-live" && message.serverContent?.turnComplete))
        )
          complete("complete");
      },
    },
  });
  if (!settled) {
    started = true;
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
