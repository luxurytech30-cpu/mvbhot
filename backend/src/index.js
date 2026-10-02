import express from "express";
import cors from "cors";
import multer from "multer";
import { pathToFileURL } from "node:url";
import { transcribeAudio } from "./audio/transcribe-audio.js";
import { classifyRequest } from "./classify-and-answer.js";
import { screenFromImageName, buildNavigationRoute } from "./navigation/find-navigation-route.js";
import { answerInformation } from "./information/general/answer-information.js";
import { answerUserInfo } from "./information/private/answer-user-info.js";
import { explainNavigationRoute } from "./navigation/explain-navigation-route.js";
import { generateSpeech } from "./audio/generate-speech.js";
import { providerErrorResponse } from "./ai/format-provider-error.js";
import { timedAction } from "./action-timer.js";

export const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

let nextRequestId = 0;

app.post("/api/assistant", upload.single("audio"), async (req, res) => {
  const requestStarted = performance.now();
  const requestId = ++nextRequestId;
  let actionNumber = 0;
  const runAction = (label, work) => timedAction(`[Assistant ${requestId}] ${++actionNumber}. ${label}`, work);
  let outcome = "failed";
  console.log(`[Assistant ${requestId}] Request: started`);

  try {
    const { imageName, message } = req.body;
    const userMessage = req.file
      ? await runAction("Transcribe audio", () => transcribeAudio(req.file))
      : await runAction("Read typed message", () => message);

    const validMessage = await runAction("Validate message", () => typeof userMessage === "string" && Boolean(userMessage.trim()));
    if (!validMessage) {
      outcome = "rejected";
      return await runAction("Send validation error", () => res.status(400).json({ error: "Send either message or audio" }));
    }

    const request = await runAction("Classify request and select destination or information category", () =>
      classifyRequest(userMessage, imageName)
    );
    console.log(`[Assistant ${requestId}] Request type: ${request.type}`);

    let navigation = null;
    let answer;
    let presentation = null;

    if (request.type === "navigation") {
      if (!imageName) {
        outcome = "rejected";
        return await runAction("Send validation error", () => res.status(400).json({ error: "imageName is required for navigation" }));
      }

      const currentScreen = await runAction("Identify current screen", () =>
        screenFromImageName(imageName)
      );
      console.log(`[Assistant ${requestId}] Current screen: ${currentScreen}`);

      console.log(`[Assistant ${requestId}] Destination: ${request.targetScreen}`);

      navigation = await runAction("Find shortest graph route", () =>
        buildNavigationRoute({ imageName, targetScreen: request.targetScreen, userIntent: request.userIntent })
      );
      console.log(`[Assistant ${requestId}] Planned route actions: ${navigation.steps.length}`);
      for (const step of navigation.steps) {
        console.log(`[Assistant ${requestId}] Planned action ${step.step}: ${step.fromScreen} --${step.action}--> ${step.toScreen}`);
      }

      answer = navigation.finalInstruction;
      if (navigation.success && navigation.steps.length > 0) {
        try {
          answer = await runAction("Explain route", () =>
            explainNavigationRoute({ message: userMessage, route: navigation })
          );
        } catch (error) {
          console.error(`[Assistant ${requestId}] Using graph instructions after route explanation failed:`, error);
        }
      } else {
        answer = await runAction("Use graph answer", () => navigation.finalInstruction);
      }
    } else if (request.type === "user_data") {
      console.log(`[Assistant ${requestId}] User information category: ${request.category}`);
      const response = await runAction("Answer from selected user data", () =>
        answerUserInfo({ message: userMessage, category: request.category }, runAction)
      );
      ({ answer, presentation } = response);
    } else {
      console.log(`[Assistant ${requestId}] Information category: ${request.category}`);
      const response = await runAction("Answer from selected information category", () =>
        answerInformation({ message: userMessage, category: request.category }, runAction)
      );
      ({ answer, presentation } = response);
    }

    if (typeof answer !== "string" || !answer.trim()) {
      throw new Error("The AI service returned an empty answer");
    }

    let audioBase64 = null;
    try {
      const audioBuffer = await runAction("Generate speech", () => generateSpeech(answer, runAction));
      audioBase64 = await runAction("Encode speech audio", () => audioBuffer.toString("base64"));
    } catch (error) {
      console.error(`[Assistant ${requestId}] Speech generation failed; returning the written answer:`, error);
    }

    await runAction("Send response", () => res.json({
      success: true,
      type: request.type,
      transcript: userMessage,
      currentScreen: navigation?.currentScreen ?? null,
      targetScreen: navigation?.targetScreen ?? null,
      steps: navigation?.steps ?? [],
      answer,
      presentation,
      audio: audioBase64 ? { mimeType: "audio/wav", data: audioBase64 } : null,
    }));
    outcome = "completed";
  } catch (error) {
    console.error(`[Assistant ${requestId}] Assistant error:`, error);
    const failure = providerErrorResponse(error, "Assistant request failed");
    await runAction("Send error response", () => res.status(failure.status).json({ success: false, ...failure }));
  } finally {
    console.log(`[Assistant ${requestId}] Request: ${outcome} in ${(performance.now() - requestStarted).toFixed(3)} ms`);
  }
});

const PORT = process.env.PORT || 5000;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
