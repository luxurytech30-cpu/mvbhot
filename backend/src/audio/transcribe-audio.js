import { ai, transcriptionModel } from '../ai/ai-models.js';

export async function transcribeAudio(file) {
  const response = await ai.models.generateContent({
    model: transcriptionModel,
    contents: [{ role: "user", parts: [
      { text: "The audio is in Hebrew. Transcribe the spoken words exactly using Hebrew letters. Do not translate into Arabic or any other language. Return only the transcript." },
      { inlineData: { mimeType: file.mimetype || "audio/webm", data: file.buffer.toString("base64") } },
    ] }],
  });
  return response.text.trim();
}
