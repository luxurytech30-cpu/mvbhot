import { GoogleGenAI } from "@google/genai";
import { geminiHttpOptions } from "./gemini-config.js";
import "dotenv/config";

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: geminiHttpOptions });

function requiredSetting(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set in backend/.env`);
  return value;
}

export const answerModel = requiredSetting("GEMMA_MODEL");
export const transcriptionModel = requiredSetting("GEMINI_STT_MODEL");
export const speechModels = requiredSetting("GEMINI_TTS_MODELS").split(",").map(model => model.trim());
export const speechVoiceStyles = requiredSetting("GEMINI_TTS_VOICE_CONFIG_STYLES").split(",").map(style => style.trim());

if (speechModels.some(model => !model) || speechVoiceStyles.length !== speechModels.length
  || speechVoiceStyles.some(style => style !== "direct" && style !== "prebuilt")) {
  throw new Error("GEMINI_TTS_MODELS and GEMINI_TTS_VOICE_CONFIG_STYLES must have matching entries (direct or prebuilt)");
}
