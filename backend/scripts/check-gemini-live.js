import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { createGeminiLiveConfig, geminiLiveModel } from "../src/live/gemini-live-config.js";

// Checks model access and session configuration; sends no audio or account records.
const model = geminiLiveModel();
const safe = (value) =>
  String(value || "Connection failed").replaceAll(
    process.env.GEMINI_API_KEY || "__unset_key__",
    "[redacted]",
  );
const timer = setTimeout(() => {
  console.error("Live setup timed out.");
  process.exit(1);
}, 25000);
try {
  const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { apiVersion: "v1alpha" },
  });
  const session = await client.live.connect({
    model,
    config: createGeminiLiveConfig(),
    callbacks: {
      onmessage() {},
      onerror: (event) => {
        console.error(safe(event.message));
        clearTimeout(timer);
        process.exit(1);
      },
      onclose: (event) => {
        if (event.code !== 1000) {
          console.error(`Live connection rejected (${event.code}): ${safe(event.reason)}`);
          clearTimeout(timer);
          process.exit(1);
        }
      },
    },
  });
  console.log(`Live setup accepted: ${model}`);
  session.close();
} catch (error) {
  console.error(safe(error.message));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
